"""Mirror this laptop's database into Netlify Database after every change.

The laptop is the source of truth and the only place anything is written; the
website (netlify/) is a read-only view of the mirror. Every successful change
here — an import, an edit, a deletion — schedules a publish that rewrites the
mirrored tables in the cloud inside one transaction.

Publishing is strictly best-effort. Choosing to publish on every change means
saving now also talks to the network, so the one rule is that the cloud can
never break a local save: publishes run on a background thread after the
request has already returned, and a failure (offline, Netlify down, bad
credentials) is recorded and retried rather than raised. The laptop stays fully
usable with the cloud unreachable or not set up at all.

A full mirror rather than a diff, deliberately. The whole database is a few
hundred rows, so rewriting it costs well under a second, and it cannot drift:
deletions, renames and repairs made directly in SQLite all arrive without any
change tracking that could miss one.

Not configured (no ~/.stocks-analyzer/cloud.env) means every call here is a
no-op and the app behaves exactly as it always has.
"""
import json
import os
import socket
import sqlite3
import ssl
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, unquote, urlparse

import database

# Outside the repo (which is public) and outside iCloud Drive: this file holds
# a credential with write access to the cloud database. Overridable the same
# way STOCKS_DB_PATH is, so a test never touches the real one.
CONFIG_DIR = Path(os.environ.get("STOCKS_CLOUD_CONFIG_DIR")
                  or Path.home() / ".stocks-analyzer")
CONFIG_FILE = CONFIG_DIR / "cloud.env"
STATE_FILE = CONFIG_DIR / "publish_state.json"

# Bursts — an import is several requests in quick succession — collapse into
# one publish that starts this long after the last of them.
DEBOUNCE_SECONDS = 2.0
CONNECT_TIMEOUT = 15

# Every table the website reads, and the exact columns, in the cloud schema's
# order (netlify/database/migrations). user_sessions is deliberately absent:
# the website keeps its own logins, and a mirror would sign them all out.
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


def _connection_url() -> Optional[str]:
    try:
        for line in CONFIG_FILE.read_text().splitlines():
            line = line.strip()
            if line.startswith("CLOUD_DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'") or None
    except FileNotFoundError:
        return None
    return None


def configured() -> bool:
    return _connection_url() is not None


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
        "row_counts": state.get("row_counts"),
    }


def _connect(url: str):
    # pg8000 takes parameters rather than a URL, and Netlify's database
    # requires TLS — which a plain local Postgres (or the test server) does not
    # offer, so sslmode in the URL decides.
    import pg8000.dbapi

    parts = urlparse(url)
    query = parse_qs(parts.query)
    sslmode = (query.get("sslmode") or ["require"])[0]
    ssl_context = None if sslmode == "disable" else ssl.create_default_context()
    return pg8000.dbapi.connect(
        user=unquote(parts.username or ""),
        password=unquote(parts.password or "") or None,
        host=parts.hostname or "localhost",
        port=parts.port or 5432,
        database=(parts.path or "/").lstrip("/") or "postgres",
        ssl_context=ssl_context,
        timeout=CONNECT_TIMEOUT,
    )


def _snapshot() -> Dict[str, list]:
    """Every mirrored row, read inside one SQLite transaction so the tables
    are consistent with each other even if the app writes mid-read."""
    src = sqlite3.connect(f"file:{database.DB_PATH}?mode=ro", uri=True,
                          isolation_level=None, timeout=30)
    try:
        src.execute("BEGIN")
        rows = {}
        for table, columns in MIRRORED.items():
            cols = ", ".join(f'"{c}"' for c in columns)
            rows[table] = src.execute(f"SELECT {cols} FROM {table}").fetchall()
        src.execute("COMMIT")
        return rows
    finally:
        src.close()


def _readable(error: Exception) -> str:
    """pg8000 reports a server error as a dict of protocol fields; the
    sentence a person can act on is the 'M' (message) field."""
    detail = error.args[0] if error.args else None
    if isinstance(detail, dict) and detail.get("M"):
        return f"Cloud database refused the data: {detail['M']}"
    return f"{type(error).__name__}: {error}"


def publish_now(reason: str = "manual") -> Dict[str, Any]:
    """Mirror everything to the cloud. Never raises; returns what happened."""
    global _dirty
    url = _connection_url()
    if not url:
        return {"published": False, "reason": "cloud not configured"}

    with _lock:
        _dirty = False
        started = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _write_state(last_attempt_at=started, last_reason=reason, pending=True)
        try:
            rows = _snapshot()
            conn = _connect(url)
            try:
                cur = conn.cursor()
                # pg8000's DB-API connection opens the transaction implicitly;
                # nothing is visible to the website until the commit, so a
                # failure halfway leaves the previous mirror fully intact.
                for table, columns in MIRRORED.items():
                    cur.execute(f'DELETE FROM "{table}"')
                    if rows[table]:
                        cols = ", ".join(f'"{c}"' for c in columns)
                        marks = ", ".join(["%s"] * len(columns))
                        cur.executemany(
                            f'INSERT INTO "{table}" ({cols}) VALUES ({marks})', rows[table])
                counts = {t: len(r) for t, r in rows.items()}
                cur.execute(
                    """INSERT INTO publish_state (id, published_at, source, row_counts)
                       VALUES (1, NOW(), %s, %s)
                       ON CONFLICT (id) DO UPDATE SET published_at = EXCLUDED.published_at,
                           source = EXCLUDED.source, row_counts = EXCLUDED.row_counts""",
                    (socket.gethostname(), json.dumps(counts)))
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        except Exception as error:  # noqa: BLE001 — must never reach a request
            message = _readable(error)
            _write_state(pending=True, last_error=message)
            print(f"[cloud] publish failed ({reason}): {message}")
            return {"published": False, "reason": message}

        finished = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _write_state(pending=False, last_error=None, last_success_at=finished,
                     row_counts=counts)
        print(f"[cloud] published ({reason}): {sum(counts.values())} rows")
        result = {"published": True, "row_counts": counts}

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
