"""
promote_admin.py
Utility script to promote any registered user to 'admin' role.

Usage:
    python promote_admin.py your_email@example.com
"""
import sys
import core.config
from core.database import SessionLocal
from core.models import User

def promote(email: str):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email.strip().lower()).first()
        if not user:
            print(f"❌ User with email '{email}' not found.")
            print("Registered users in database:")
            all_users = db.query(User).all()
            for u in all_users:
                print(f"  - {u.email} ({u.full_name}) [role: {u.role}]")
            return

        user.role = "admin"
        db.commit()
        print(f"[SUCCESS] '{user.email}' ({user.full_name}) has been promoted to 'admin'.")
        print("Log out and log back in (or refresh) to access the Admin Console.")
    finally:
        db.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python promote_admin.py <email>")
        print("\nRegistered users in database:")
        db = SessionLocal()
        try:
            for u in db.query(User).all():
                print(f"  - {u.email} ({u.full_name}) [role: {u.role}]")
        finally:
            db.close()
    else:
        promote(sys.argv[1])
