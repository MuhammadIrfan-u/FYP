import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


def get_utc_now() -> datetime:
    return datetime.now(UTC)


class SessionModel(Base):
    """Represents a football video analysis session matching schema.sql sessions table."""

    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), nullable=False)
    title = Column(String(255), nullable=False, default="Football Session")
    video_path = Column(String(1024), nullable=False)
    original_file_name = Column(String(255), nullable=True)
    video_duration_seconds = Column(Float, nullable=True, default=0.0)
    status = Column(String(50), nullable=False, default="uploaded")

    # Match aggregate metrics
    total_goals = Column(Integer, nullable=False, default=0)
    total_shots = Column(Integer, nullable=False, default=0)
    total_passes = Column(Integer, nullable=False, default=0)
    total_sprints = Column(Integer, nullable=False, default=0)

    # JSON payloads
    class_counts = Column(
        JSON,
        nullable=False,
        default=lambda: {
            "player": 0,
            "football": 0,
            "player_with_ball": 0,
            "football_goal": 0,
        },
    )
    analytics = Column(JSON, nullable=False, default=dict)

    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(
        DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now
    )

    # Relationships
    events = relationship(
        "SessionEventModel",
        back_populates="session",
        cascade="all, delete-orphan",
    )
    statistics = relationship(
        "SessionStatisticsModel",
        back_populates="session",
        uselist=False,
        cascade="all, delete-orphan",
    )


class SessionEventModel(Base):
    """Represents an AI/manual tactical event detected in a session matching session_events table."""

    __tablename__ = "session_events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(
        String(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    event_type = Column(String(50), nullable=False)  # goal, shot, pass, sprint, dribble
    title = Column(String(255), nullable=False)
    description = Column(String(1024), nullable=True)
    timestamp_seconds = Column(Float, nullable=False)
    end_timestamp_seconds = Column(Float, nullable=True)
    confidence = Column(Float, nullable=True)
    detected_classes = Column(JSON, nullable=False, default=list)
    metadata_payload = Column("metadata", JSON, nullable=False, default=dict)
    source = Column(String(20), nullable=False, default="ai")  # ai, manual, corrected
    created_at = Column(DateTime, nullable=False, default=get_utc_now)

    session = relationship("SessionModel", back_populates="events")


class SessionStatisticsModel(Base):
    """Represents overall session statistical summary matching session_statistics table."""

    __tablename__ = "session_statistics"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(
        String(36),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    stats = Column(
        JSON,
        nullable=False,
        default=lambda: {
            "goals": 0,
            "shots": 0,
            "shots_on_target": 0,
            "shots_off_target": 0,
            "missed_shots": 0,
            "passes": 0,
            "successful_passes": 0,
            "failed_passes": 0,
            "dribbles": 0,
            "sprints": 0,
            "saves": 0,
            "interceptions": 0,
            "tackles": 0,
            "fouls": 0,
            "offsides": 0,
            "possession_percentage": 0,
        },
    )
    updated_at = Column(
        DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now
    )

    session = relationship("SessionModel", back_populates="statistics")
