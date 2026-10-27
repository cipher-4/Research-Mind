
"""
create_tables.py
Run this ONCE to:
  1. Create all tables (users, research_sessions, research_findings) in PostgreSQL.
  2. Seed the first super-admin account.
"""
import core.config  # Load .env before anything else

from core.database import engine, Base, SessionLocal
from core.models import User, ResearchSession, ResearchFinding
from core.auth import hash_password, get_user_by_email

# ──────────────────────────────────────────────
#  STEP 1: Create all tables
# ──────────────────────────────────────────────
print("Creating tables in PostgreSQL...")
Base.metadata.create_all(bind=engine)
print("✓ All tables created successfully!")

# ──────────────────────────────────────────────
#  STEP 2: Seed the first admin account
# ──────────────────────────────────────────────
ADMIN_EMAIL = "admin@researchmind.com"
ADMIN_PASSWORD = "admin123"
ADMIN_NAME = "Admin"

db = SessionLocal()
try:
    existing = get_user_by_email(db, ADMIN_EMAIL)
    if existing:
        print(f"⚠ Admin account '{ADMIN_EMAIL}' already exists. Skipping seed.")
    else:
        admin_user = User(
            email=ADMIN_EMAIL,
            hashed_password=hash_password(ADMIN_PASSWORD),
            full_name=ADMIN_NAME,
            role="admin",
            is_active=True
        )
        db.add(admin_user)
        db.commit()
        print(f"✓ Super-admin account created!")
        print(f"  Email:    {ADMIN_EMAIL}")
        print(f"  Password: {ADMIN_PASSWORD}")
        print(f"  Role:     admin")
        print(f"\n  ⚠ Change this password after first login!")
finally:
    db.close()

print("\nDone! Your database is ready.")