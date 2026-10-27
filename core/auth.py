"""
auth.py
Handles password hashing (bcrypt) and JWT token creation/verification.
"""
import os
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
from sqlalchemy.orm import Session
from core.models import User

# ──────────────────────────────────────────────
#  PASSWORD HASHING (native bcrypt)
# ──────────────────────────────────────────────
def hash_password(plain_password: str) -> str:
    """Takes a plain text password and returns a salted bcrypt hash."""
    pwd_bytes = plain_password.encode("utf-8")
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Checks if a plain text password matches the stored bcrypt hash."""
    pwd_bytes = plain_password.encode("utf-8")
    hash_bytes = hashed_password.encode("utf-8")
    return bcrypt.checkpw(pwd_bytes, hash_bytes)


# ──────────────────────────────────────────────
#  JWT TOKENS
# ──────────────────────────────────────────────
JWT_SECRET = os.environ.get("JWT_SECRET", "fallback-secret-key")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24


def create_access_token(user: User) -> str:
    """
    Creates a JWT token containing the user's id, email, and role.
    Expires after 24 hours.
    """
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    """
    Decodes a JWT token and returns the payload.
    Returns None if the token is expired or invalid.
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


# ──────────────────────────────────────────────
#  USER LOOKUP HELPERS
# ──────────────────────────────────────────────
def get_user_by_email(db: Session, email: str) -> User | None:
    """Finds a user by their email address."""
    return db.query(User).filter(User.email == email).first()


def get_current_user(db: Session, token: str) -> User | None:
    """
    Decodes the JWT token, extracts the user id,
    and returns the full User object from the database.
    Returns None if token is invalid or user doesn't exist.
    """
    payload = decode_access_token(token)
    if payload is None:
        return None
    user = db.query(User).filter(User.id == payload["sub"]).first()
    if user is None or not user.is_active:
        return None
    return user
