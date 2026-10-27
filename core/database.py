"""
database.py
Connects to PostgreSQL and provides a session factory for the app.
"""
import os
import core.config  # Ensure .env is loaded before reading DATABASE_URL
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Read the connection string from .env
DATABASE_URL = os.environ.get("DATABASE_URL")

# Create the engine — this is the actual connection to PostgreSQL
engine = create_engine(DATABASE_URL)

# SessionLocal is a factory — every time you call SessionLocal(), 
# it gives you a fresh database session to run queries
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

# Base is the parent class that all our table models will inherit from
Base = declarative_base()


def get_db():
    """
    Dependency for FastAPI routes.
    Opens a database session, yields it for the route to use,
    and automatically closes it when the route finishes.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
