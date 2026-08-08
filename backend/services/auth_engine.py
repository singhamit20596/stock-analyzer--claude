"""Usernames, passwords and login tokens.

The app runs on localhost for a household, so this is deliberately small: no
email, no reset flow, no OAuth. What it does not cut corners on is password
storage and token handling, because people reuse passwords everywhere and a
weak hash here would leak far beyond this app.

Hashing is PBKDF2-HMAC-SHA256 from the standard library. bcrypt or argon2 would
be stronger per unit of work, but both are compiled dependencies and this
project installs on a path where that is painful; PBKDF2 with a high iteration
count is the strongest thing available without one.
"""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import models

# OWASP's floor for PBKDF2-HMAC-SHA256 at the time of writing.
PBKDF2_ITERATIONS = 600_000
SALT_BYTES = 16
TOKEN_BYTES = 32
SESSION_DAYS = 30

MIN_USERNAME = 3
MIN_PASSWORD = 8

ADMIN_ROLE = "admin"
USER_ROLE = "user"


def hash_password(password: str) -> str:
    """Encode as `pbkdf2_sha256$iterations$salt$digest`, all hex."""
    salt = os.urandom(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt,
                                 PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    """Constant-time check of *password* against a stored hash."""
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                     bytes.fromhex(salt_hex), int(iterations))
    except (ValueError, AttributeError):
        return False
    return hmac.compare_digest(expected, actual)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def validate_credentials(username: str, password: str) -> Optional[str]:
    """The reason these credentials are unacceptable, or None."""
    username = (username or "").strip()
    if len(username) < MIN_USERNAME:
        return f"Username must be at least {MIN_USERNAME} characters."
    if not username.replace("_", "").replace("-", "").isalnum():
        return "Username may only contain letters, numbers, hyphens and underscores."
    if len(password or "") < MIN_PASSWORD:
        return f"Password must be at least {MIN_PASSWORD} characters."
    return None


def find_user(db, username: str) -> Optional[models.User]:
    return (db.query(models.User)
            .filter(models.User.username == (username or "").strip().lower())
            .first())


def user_count(db) -> int:
    return db.query(models.User).count()


def create_user(db, username: str, password: str) -> models.User:
    """Register a login. The first one created runs the place.

    Whoever registers first becomes the admin, so the app should be opened and
    claimed before anyone else is given the address.
    """
    role = ADMIN_ROLE if user_count(db) == 0 else USER_ROLE
    user = models.User(
        username=username.strip().lower(),
        password_hash=hash_password(password),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate(db, username: str, password: str) -> Optional[models.User]:
    """The matching user, or None.

    A missing username still runs a hash so that a wrong name and a wrong
    password take the same time to reject, and the caller returns the same
    message for both.
    """
    user = find_user(db, username)
    if user is None:
        hash_password(password or "")
        return None
    if not verify_password(password or "", user.password_hash):
        return None
    return user


def issue_token(db, user: models.User) -> Tuple[str, datetime]:
    """A new session token. Only its hash is kept."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    db.add(models.UserSession(
        token_hash=_hash_token(token),
        user_id=user.id,
        expires_at=expires,
    ))
    db.commit()
    return token, expires


def resolve_token(db, token: str) -> Optional[models.User]:
    """The user this token belongs to, if it is live."""
    if not token:
        return None
    session = (db.query(models.UserSession)
               .filter(models.UserSession.token_hash == _hash_token(token))
               .first())
    if session is None:
        return None

    # SQLite hands back naive datetimes; compare in UTC either way.
    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        db.delete(session)
        db.commit()
        return None

    return db.query(models.User).filter(models.User.id == session.user_id).first()


def revoke_token(db, token: str) -> None:
    if not token:
        return
    (db.query(models.UserSession)
     .filter(models.UserSession.token_hash == _hash_token(token))
     .delete())
    db.commit()


# Tables whose rows belong to one user. Everything else hangs off these.
OWNED_MODELS = ("Account", "Portfolio", "TargetPortfolio", "WatchStock")


def claim_unowned_data(db, user: models.User) -> dict:
    """Hand every ownerless row to *user*.

    The app predates logins, so the data already in the database has no owner.
    It is given to the first account created — the admin — rather than being
    left invisible to everyone.
    """
    claimed = {}
    for name in OWNED_MODELS:
        model = getattr(models, name)
        rows = db.query(model).filter(model.user_id.is_(None)).all()
        for row in rows:
            row.user_id = user.id
        claimed[name] = len(rows)
    db.commit()
    return claimed
