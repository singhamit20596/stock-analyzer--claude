"""Publish this laptop's data to the cloud website after every change.

The laptop is the source of truth and the only place anything is written; the
website (netlify/) is a read-only view of what was last published. Every
successful change here — an import, an edit, a deletion — schedules a publish:

    SQLite ──► one JSON document ──► gzip ──► AES-256-GCM ──► cloud/data/snapshot.json
           ──► git commit + push to the `netlify` branch ──► Netlify rebuilds (~1 min)

The repository is public, so the file in it is always encrypted. The key lives
in ~/.stocks-analyzer/cloud.env on this laptop and in the DATA_KEY environment
variable on Netlify, nowhere else. Without the key the file is noise; with a
wrong key or a tampered file, decryption fails outright (GCM authenticates).

Publishing is strictly best-effort. Choosing to publish on every change means
saving now also talks to the network, so the one rule is that the cloud can
never break a local save: publishes run on a background thread after the
request has already returned, and a failure (offline, GitHub down, push
rejected) is recorded and retried rather than raised.

A full snapshot rather than a diff, deliberately. The whole database is a few
hundred rows, so it cannot drift: deletions, renames and repairs made directly
in SQLite all arrive without any change tracking that could miss one.

Not configured (no ~/.stocks-analyzer/cloud.env) means every call here is a
no-op and the app behaves exactly as it always has.
"""
import base64
import gzip
import hashlib
import hmac
import json
import os
import socket
import sqlite3
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import database

# Outside the repo (which is public) and outside iCloud Drive: cloud.env holds
# the encryption key. Overridable the same way STOCKS_DB_PATH is, so a test
# never touches the real one.
CONFIG_DIR = Path(os.environ.get("STOCKS_CLOUD_CONFIG_DIR")
                  or Path.home() / ".stocks-analyzer")
CONFIG_FILE = CONFIG_DIR / "cloud.env"
STATE_FILE = CONFIG_DIR / "publish_state.json"
# A clone used only by the publisher, so publishing never touches a checkout
# someone is working in.
PUBLISH_REPO = CONFIG_DIR / "publish-repo"

DEFAULT_REMOTE = "https://github.com/singhamit20596/stock-analyzer--claude.git"
BRANCH = "netlify"
DATA_PATH = "cloud/data/snapshot.json"

# Bound into the ciphertext: a file encrypted for anything else will not
# decrypt as a snapshot. Must match cloud/lib/snapshot.ts.
FORMAT = "stocks-analyzer-snapshot"
VERSION = 1
AAD = f"{FORMAT}-v{VERSION}".encode()

# Bursts — an import is several requests in quick succession — collapse into
# one publish that starts this long after the last of them.
DEBOUNCE_SECONDS = 2.0
GIT_TIMEOUT = 90
PUSH_ATTEMPTS = 3

# Every table the website reads, and the exact columns. user_sessions is
# deliberately absent: a laptop session token has no business on the website.
MIRRORED: Dict[str, tuple] = {
    "users": ("id", "username", "password_hash", "role", "created_at"),
    "accounts": ("id", "name", "currency_type", "created_at", "last_synced_at",
                 "wallet_balance", "latest_screenshot_path", "user_id"),
    "holdings": ("id", "account_id", "symbol", "company_name", "quantity",
                 "avg_buy_price", "current_price", "is_user_verified", "updated_at",
                 "country", "currency", "sector", "section", "first_seen_at"),
    "holding_changes": ("id", "account_id", "symbol", "company_name", "country",
                        "change_type", "quantity_before", "quantity_after",
                        "avg_price_before", "avg_price_after", "changed_at"),
    "portfolios": ("id", "user_id", "name", "created_at"),
    "portfolio_accounts": ("portfolio_id", "account_id"),
    "portfolio_daily_snapshots": ("id", "portfolio_id", "snapshot_date", "invested_inr",
                                  "current_value_inr", "recorded_at"),
    "target_portfolios": ("id", "user_id", "name", "ind_percent", "ind_cash_percent",
                          "us_cash_percent", "created_at"),
    "target_rules": ("id", "target_id", "market", "dimension", "key", "percent"),
    "watch_stocks": ("id", "user_id", "symbol", "company_name", "country", "sector",
                     "section", "created_at"),
    "sync_logs": ("id", "account_id", "status", "message", "created_at",
                  "holdings_count", "error_message", "synced_at"),
}

_lock = threading.Lock()          # one publish at a time
_timer: Optional[threading.Timer] = None
_timer_lock = threading.Lock()
_dirty = False                    # a change arrived while a publish was running


# ── configuration ────────────────────────────────────────────────────────────

def _config() -> Dict[str, str]:
    values: Dict[str, str] = {}
    try:
        for line in CONFIG_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                name, value = line.split("=", 1)
                values[name.strip()] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return values


def _key() -> bytes:
    key = base64.b64decode(_config().get("CLOUD_DATA_KEY", ""))
    if len(key) != 32:
        raise ValueError("CLOUD_DATA_KEY must be 32 bytes, base64-encoded")
    return key


def configured() -> bool:
    return bool(_config().get("CLOUD_DATA_KEY"))


def _read_state() -> Dict[str, Any]:
    try:
        return json.loads(STATE_FILE.read_text())
    except (FileNotFoundError, ValueError):
        return {}


def _write_state(**changes: Any) -> None:
    state = _read_state()
    state.update(changes)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE_FILE)


def status() -> Dict[str, Any]:
    state = _read_state()
    return {
        "configured": configured(),
        "pending": bool(state.get("pending")),
        "last_success_at": state.get("last_success_at"),
        "last_attempt_at": state.get("last_attempt_at"),
        "last_error": state.get("last_error"),
        "last_reason": state.get("last_reason"),
        "last_commit": state.get("last_commit"),
        "row_counts": state.get("row_counts"),
    }


# ── the snapshot ─────────────────────────────────────────────────────────────

def _snapshot() -> Dict[str, list]:
    """Every mirrored row as {column: value}, read inside one SQLite
    transaction so the tables agree with each other even if the app writes
    mid-read. Opened read-only: publishing can never modify the database."""
    src = sqlite3.connect(f"file:{database.DB_PATH}?mode=ro", uri=True,
                          isolation_level=None, timeout=30)
    try:
        src.execute("BEGIN")
        tables = {}
        for table, columns in MIRRORED.items():
            cols = ", ".join(f'"{c}"' for c in columns)
            rows = src.execute(f"SELECT {cols} FROM {table} ORDER BY rowid").fetchall()
            tables[table] = [dict(zip(columns, row)) for row in rows]
        src.execute("COMMIT")
        return tables
    finally:
        src.close()


def _digest(key: bytes, tables: Dict[str, list]) -> str:
    """Identifies the content without revealing it (keyed), so an unchanged
    database is not re-published — the ciphertext differs every time."""
    canonical = json.dumps(tables, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=False).encode("utf-8")
    return hmac.new(key, b"digest:" + canonical, hashlib.sha256).hexdigest()


def encrypt(key: bytes, tables: Dict[str, list], published_at: str, source: str) -> Dict[str, Any]:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    document = {
        "published_at": published_at,
        "source": source,
        "row_counts": {t: len(r) for t, r in tables.items()},
        "tables": tables,
    }
    plain = gzip.compress(json.dumps(document, ensure_ascii=False).encode("utf-8"), mtime=0)
    nonce = os.urandom(12)
    sealed = AESGCM(key).encrypt(nonce, plain, AAD)   # ciphertext || 16-byte tag
    return {
        "format": FORMAT,
        "version": VERSION,
        "cipher": "AES-256-GCM",
        "note": "Encrypted. Readable only with the key held by the laptop and the Netlify site.",
        "nonce": base64.b64encode(nonce).decode(),
        "ciphertext": base64.b64encode(sealed).decode(),
        "digest": _digest(key, tables),
    }


def decrypt(key: bytes, envelope: Dict[str, Any]) -> Dict[str, Any]:
    """The inverse, for tests and for checking what was published."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    if envelope.get("format") != FORMAT or envelope.get("version") != VERSION:
        raise ValueError("not a version-1 snapshot")
    plain = AESGCM(key).decrypt(base64.b64decode(envelope["nonce"]),
                                base64.b64decode(envelope["ciphertext"]), AAD)
    return json.loads(gzip.decompress(plain))


# ── git ──────────────────────────────────────────────────────────────────────

def _git(*args: str, cwd: Optional[Path] = None) -> str:
    result = subprocess.run(
        ["git", *args], cwd=cwd or PUBLISH_REPO, capture_output=True, text=True,
        timeout=GIT_TIMEOUT,
        # Never wait for a password prompt nobody will see.
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()[:300]
        raise RuntimeError(f"git {args[0]} failed: {detail}")
    return result.stdout.strip()


def _ensure_clone() -> None:
    if (PUBLISH_REPO / ".git").exists():
        return
    remote = _config().get("CLOUD_REPO") or DEFAULT_REMOTE
    PUBLISH_REPO.parent.mkdir(parents=True, exist_ok=True)
    _git("clone", "--quiet", "--branch", BRANCH, "--single-branch", "--depth", "1",
         remote, str(PUBLISH_REPO), cwd=PUBLISH_REPO.parent)


def _push(envelope: Dict[str, Any], message: str) -> Optional[str]:
    """Commit the envelope onto the latest remote branch and push it.
    Returns the commit, or None if the remote already holds this content."""
    _ensure_clone()
    target = PUBLISH_REPO / DATA_PATH
    for attempt in range(PUSH_ATTEMPTS):
        # Start from exactly what GitHub has, so code pushed from elsewhere is
        # kept and the only change in this commit is the data file.
        _git("fetch", "--quiet", "--depth", "1", "origin", BRANCH)
        _git("reset", "--quiet", "--hard", f"origin/{BRANCH}")
        try:
            current = json.loads(target.read_text())
        except (FileNotFoundError, ValueError):
            current = {}
        if current.get("digest") == envelope["digest"]:
            return None

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(envelope, indent=2) + "\n")
        _git("add", DATA_PATH)
        _git("-c", "user.name=Stocks Analyzer laptop",
             "-c", "user.email=publisher@stocks-analyzer.invalid",
             "commit", "--quiet", "-m", message)
        try:
            _git("push", "--quiet", "origin", f"HEAD:{BRANCH}")
            return _git("rev-parse", "--short", "HEAD")
        except RuntimeError:
            # Someone pushed in between; start again from theirs.
            if attempt == PUSH_ATTEMPTS - 1:
                raise
    return None


# ── publishing ───────────────────────────────────────────────────────────────

def publish_now(reason: str = "manual") -> Dict[str, Any]:
    """Publish everything. Never raises; returns what happened."""
    global _dirty
    if not configured():
        return {"published": False, "reason": "cloud not configured"}

    with _lock:
        _dirty = False
        started = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _write_state(last_attempt_at=started, last_reason=reason, pending=True)
        try:
            key = _key()
            tables = _snapshot()
            counts = {t: len(r) for t, r in tables.items()}
            envelope = encrypt(key, tables, started, socket.gethostname())
            commit = _push(envelope, f"Publish laptop data ({reason})")
        except Exception as error:  # noqa: BLE001 — must never reach a request
            message = f"{type(error).__name__}: {error}"
            _write_state(pending=True, last_error=message)
            print(f"[cloud] publish failed ({reason}): {message}")
            return {"published": False, "reason": message}

        finished = datetime.now(timezone.utc).isoformat(timespec="seconds")
        changes: Dict[str, Any] = dict(pending=False, last_error=None,
                                       last_success_at=finished, row_counts=counts)
        if commit:
            changes["last_commit"] = commit
        _write_state(**changes)
        print(f"[cloud] {'published ' + commit if commit else 'already current'} "
              f"({reason}): {sum(counts.values())} rows")
        result = {"published": True, "changed": bool(commit), "commit": commit,
                  "row_counts": counts}

    # A change that landed while that publish ran is not in it.
    if _dirty:
        request_publish("changes during previous publish")
    return result


def request_publish(reason: str) -> None:
    """Schedule a publish shortly; repeated calls collapse into one."""
    global _timer, _dirty
    if not configured():
        return
    _dirty = True
    with _timer_lock:
        if _timer is not None:
            _timer.cancel()
        _timer = threading.Timer(DEBOUNCE_SECONDS, publish_now, args=(reason,))
        _timer.daemon = True
        _timer.start()


def catch_up_on_start() -> None:
    """Publish once at startup, so anything that failed while offline — or
    any change made to the database by hand — reaches the cloud."""
    if configured():
        threading.Thread(target=publish_now, args=("startup",), daemon=True).start()
