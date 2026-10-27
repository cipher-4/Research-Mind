
"""
models.py
SQLAlchemy models — defines the users, research_sessions,
and research_findings tables in PostgreSQL.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Text, Float, Boolean, DateTime, Integer, ForeignKey, JSON
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from core.database import Base


# ──────────────────────────────────────────────
#  TABLE 1: users
# ──────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False)
    role = Column(String(20), nullable=False, default="user")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationship: one user has many research sessions
    sessions = relationship("ResearchSession", back_populates="owner", cascade="all, delete-orphan")


# ──────────────────────────────────────────────
#  TABLE 2: research_sessions
# ──────────────────────────────────────────────
class ResearchSession(Base):
    __tablename__ = "research_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    topic = Column(Text, nullable=False)
    status = Column(String(30), nullable=False, default="in_progress")
    synthesized_report = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    owner = relationship("User", back_populates="sessions")
    findings = relationship("ResearchFinding", back_populates="session", cascade="all, delete-orphan")


# ──────────────────────────────────────────────
#  TABLE 3: research_findings
# ──────────────────────────────────────────────
class ResearchFinding(Base):
    __tablename__ = "research_findings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("research_sessions.id", ondelete="CASCADE"), nullable=False)
    subquery = Column(Text, nullable=False)
    researcher_id = Column(Integer, nullable=False)
    model_used = Column(String(50), nullable=False)
    summary = Column(Text, nullable=True)
    sources = Column(JSON, nullable=True)
    confidence = Column(Float, nullable=True)
    arbitrator_accepted = Column(Boolean, nullable=True)

    # Relationship
    # creates the link bw table s: User → Sessions → Findings
    session = relationship("ResearchSession", back_populates="findings")