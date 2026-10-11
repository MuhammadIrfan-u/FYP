"""Test suite verifying database operations using the isolated in-memory dummy database.

Ensures that:
- Real database (PostgreSQL/Supabase) is never touched during test execution.
- All CRUD operations on sessions, events, and statistics work against the dummy SQLite DB.
- Cascade deletions, JSON serialization, and queries function properly.
"""

import uuid

from app.database import get_db
from app.models.session import SessionEventModel, SessionModel, SessionStatisticsModel


def test_dummy_db_create_and_read_session(dummy_db):
    """Verify creating and retrieving a session record in the dummy database."""
    session_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    new_session = SessionModel(
        id=session_id,
        user_id=user_id,
        title="Training Match - First Half",
        video_path="/api/videos/training_match_1.mp4",
        original_file_name="training_match_1.mp4",
        video_duration_seconds=90.5,
        status="uploaded",
        total_goals=2,
        total_shots=5,
        total_passes=24,
        total_sprints=8,
        class_counts={
            "player": 18,
            "football": 1,
            "football goal": 2,
            "player with ball": 1,
        },
        analytics={"tactical_intensity": "high"},
    )
    dummy_db.add(new_session)
    dummy_db.commit()

    retrieved = dummy_db.query(SessionModel).filter_by(id=session_id).first()
    assert retrieved is not None
    assert retrieved.id == session_id
    assert retrieved.user_id == user_id
    assert retrieved.title == "Training Match - First Half"
    assert retrieved.status == "uploaded"
    assert retrieved.total_goals == 2
    assert retrieved.class_counts["football"] == 1
    assert retrieved.analytics["tactical_intensity"] == "high"


def test_dummy_db_session_status_transitions(dummy_db):
    """Verify updating session progress status in the dummy database."""
    session = SessionModel(
        user_id=str(uuid.uuid4()),
        title="Championship Final",
        video_path="/api/videos/final.mp4",
        status="uploaded",
    )
    dummy_db.add(session)
    dummy_db.commit()

    # Step 1: Processing
    session.status = "processing"
    dummy_db.commit()
    refreshed = dummy_db.query(SessionModel).filter_by(id=session.id).first()
    assert refreshed.status == "processing"

    # Step 2: Completed with computed stats
    session.status = "completed"
    session.total_goals = 3
    session.total_shots = 12
    dummy_db.commit()
    completed = dummy_db.query(SessionModel).filter_by(id=session.id).first()
    assert completed.status == "completed"
    assert completed.total_goals == 3
    assert completed.total_shots == 12


def test_dummy_db_events_and_relationship(dummy_db):
    """Verify recording tactical events and querying through the session relationship."""
    session = SessionModel(
        user_id=str(uuid.uuid4()),
        title="Tactical Analysis Session",
        video_path="/api/videos/tactics.mp4",
        status="completed",
    )
    dummy_db.add(session)
    dummy_db.commit()

    event1 = SessionEventModel(
        session_id=session.id,
        event_type="shot",
        title="Striker shot on goal",
        timestamp_seconds=14.2,
        end_timestamp_seconds=16.0,
        confidence=0.89,
        detected_classes=["player with ball", "football goal"],
        metadata_payload={"outcome": "saved_by_keeper"},
        source="ai",
    )
    event2 = SessionEventModel(
        session_id=session.id,
        event_type="goal",
        title="Header into top right corner",
        timestamp_seconds=32.5,
        end_timestamp_seconds=35.0,
        confidence=0.96,
        detected_classes=["player", "football", "football goal"],
        metadata_payload={"outcome": "goal"},
        source="ai",
    )
    dummy_db.add_all([event1, event2])
    dummy_db.commit()

    # Query through relationship
    fetched_session = dummy_db.query(SessionModel).filter_by(id=session.id).first()
    assert len(fetched_session.events) == 2

    # Query events ordered by timeline
    ordered_events = (
        dummy_db.query(SessionEventModel)
        .filter_by(session_id=session.id)
        .order_by(SessionEventModel.timestamp_seconds)
        .all()
    )
    assert ordered_events[0].event_type == "shot"
    assert ordered_events[1].event_type == "goal"
    assert ordered_events[1].metadata_payload["outcome"] == "goal"


def test_dummy_db_statistics_model(dummy_db):
    """Verify saving detailed match statistics in the dummy database."""
    session = SessionModel(
        user_id=str(uuid.uuid4()),
        title="Quarter Final Match",
        video_path="/api/videos/qf.mp4",
        status="completed",
    )
    dummy_db.add(session)
    dummy_db.commit()

    stats_record = SessionStatisticsModel(
        session_id=session.id,
        stats={
            "goals": 2,
            "shots": 8,
            "shots_on_target": 6,
            "shots_off_target": 2,
            "successful_passes": 45,
            "failed_passes": 5,
            "possession_percentage": 58,
        },
    )
    dummy_db.add(stats_record)
    dummy_db.commit()

    queried_stats = (
        dummy_db.query(SessionStatisticsModel).filter_by(session_id=session.id).first()
    )
    assert queried_stats is not None
    assert queried_stats.stats["goals"] == 2
    assert queried_stats.stats["possession_percentage"] == 58


def test_dummy_db_cascade_delete(dummy_db):
    """Verify deleting a session cascades and removes associated events and statistics."""
    session = SessionModel(
        user_id=str(uuid.uuid4()),
        title="Temporary Session to Delete",
        video_path="/api/videos/temp.mp4",
    )
    dummy_db.add(session)
    dummy_db.commit()

    event = SessionEventModel(
        session_id=session.id,
        event_type="sprint",
        title="Left winger counter attack",
        timestamp_seconds=5.0,
    )
    stats = SessionStatisticsModel(
        session_id=session.id,
        stats={"goals": 0, "sprints": 1},
    )
    dummy_db.add_all([event, stats])
    dummy_db.commit()

    session_id = session.id
    # Delete parent session
    dummy_db.delete(session)
    dummy_db.commit()

    # Both child records must be deleted
    assert dummy_db.query(SessionModel).filter_by(id=session_id).first() is None
    assert (
        dummy_db.query(SessionEventModel).filter_by(session_id=session_id).first()
        is None
    )
    assert (
        dummy_db.query(SessionStatisticsModel).filter_by(session_id=session_id).first()
        is None
    )


def test_dummy_db_filtering_and_queries(dummy_db):
    """Verify querying by user_id and filtering by event attributes."""
    user_a = str(uuid.uuid4())
    user_b = str(uuid.uuid4())

    s1 = SessionModel(
        user_id=user_a,
        title="User A Session 1",
        video_path="v1.mp4",
        status="completed",
    )
    s2 = SessionModel(
        user_id=user_a,
        title="User A Session 2",
        video_path="v2.mp4",
        status="uploaded",
    )
    s3 = SessionModel(
        user_id=user_b,
        title="User B Session 1",
        video_path="v3.mp4",
        status="completed",
    )

    dummy_db.add_all([s1, s2, s3])
    dummy_db.commit()

    # User A sessions
    user_a_sessions = dummy_db.query(SessionModel).filter_by(user_id=user_a).all()
    assert len(user_a_sessions) == 2

    # Completed sessions only
    completed_sessions = (
        dummy_db.query(SessionModel).filter_by(status="completed").all()
    )
    assert len(completed_sessions) == 2


def test_dummy_db_fastapi_dependency_injection(dummy_db):
    """Verify FastAPI's dependency override provides the dummy in-memory database session."""
    from app import main

    override_gen = main.app.dependency_overrides[get_db]()
    session = next(override_gen)
    assert session is not None
    count = session.query(SessionModel).count()
    assert count >= 0
