"""
Transparent field-level encryption for sensitive DB columns.

Set ENCRYPTION_KEY in Railway to a URL-safe base64 32-byte key:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

If ENCRYPTION_KEY is not set the columns store plaintext (backwards-compatible).
Existing plaintext rows are read back safely — Fernet.decrypt() is only called
on values that start with the gAA… token prefix.
"""

import os
import base64
import logging
from sqlalchemy import String
from sqlalchemy.types import TypeDecorator

log = logging.getLogger(__name__)

_FERNET_PREFIX = b"gAAAAA"  # every Fernet token starts with this


def _get_fernet():
    key = os.getenv("ENCRYPTION_KEY", "").strip()
    if not key:
        return None
    try:
        from cryptography.fernet import Fernet
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as e:
        log.error("Invalid ENCRYPTION_KEY — credentials will be stored plaintext: %s", e)
        return None


def encrypt(value: str) -> str:
    """Encrypt a string. Returns plaintext if ENCRYPTION_KEY is not set."""
    if not value:
        return value
    f = _get_fernet()
    if f is None:
        return value
    return f.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    """Decrypt a string. Safely handles plaintext values (pre-encryption rows)."""
    if not value:
        return value
    # If it doesn't look like a Fernet token, it's plaintext — return as-is
    try:
        raw = value.encode()
        if not base64.urlsafe_b64decode(raw[:8] + b"==")[:4] == b"\x80":
            return value
    except Exception:
        return value
    f = _get_fernet()
    if f is None:
        return value
    try:
        return f.decrypt(raw).decode()
    except Exception:
        # Already plaintext or wrong key — return as-is to avoid data loss
        log.warning("Could not decrypt field value — returning raw (may be plaintext)")
        return value


class EncryptedString(TypeDecorator):
    """
    SQLAlchemy column type that transparently encrypts on write and
    decrypts on read using Fernet symmetric encryption.

    Usage:
        column = Column(EncryptedString(512))
    """
    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        """Encrypt before writing to DB."""
        if value is None:
            return value
        return encrypt(str(value))

    def process_result_value(self, value, dialect):
        """Decrypt after reading from DB."""
        if value is None:
            return value
        return decrypt(str(value))
