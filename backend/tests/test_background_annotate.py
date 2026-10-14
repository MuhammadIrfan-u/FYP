import json
import numpy as np
import pytest
from app.main import parse_detections
from tests.conftest import MockBox, MockYOLOResult


def test_parse_detections_per_class_confidence_thresholds():
    """
    Verifies that per-class confidence thresholds (e.g. football goal 35%)
    correctly discard detections that are below the class threshold,
    while keeping detections above it.
    """
    # Sample detections:
    # 1. football goal with conf 0.32 (should be discarded if goal threshold is 0.35)
    # 2. football goal with conf 0.38 (should be kept)
    # 3. football with conf 0.28 (discarded if football threshold is 0.30)
    # 4. football with conf 0.34 (kept)
    # 5. player with conf 0.22 (discarded if player threshold is 0.25)
    # 6. player with conf 0.27 (kept)
    boxes = [
        MockBox(cls_id=1, conf=0.32, xywhn=[0.8, 0.2, 0.2, 0.3]),  # goal 32%
        MockBox(cls_id=1, conf=0.38, xywhn=[0.85, 0.25, 0.15, 0.25]), # goal 38%
        MockBox(cls_id=0, conf=0.28, xywhn=[0.5, 0.5, 0.1, 0.1]),  # football 28%
        MockBox(cls_id=0, conf=0.34, xywhn=[0.52, 0.52, 0.1, 0.1]), # football 34%
        MockBox(cls_id=2, conf=0.22, xywhn=[0.2, 0.3, 0.15, 0.4]),  # player 22%
        MockBox(cls_id=2, conf=0.27, xywhn=[0.25, 0.35, 0.15, 0.4]), # player 27%
    ]
    res = [MockYOLOResult(boxes)]

    # Mock class names
    from unittest.mock import MagicMock
    from app import main

    mock_model = MagicMock()
    mock_model.names = {0: "football", 1: "football goal", 2: "player", 3: "player with ball"}
    main.model = mock_model

    class_confs = {
        "football goal": 0.35,
        "football": 0.30,
        "player": 0.25,
    }

    parsed = parse_detections(res, conf_threshold=0.20, class_confidences=class_confs)
    dets = parsed["detections"]
    counts = parsed["class_counts"]

    # Goal: exactly 1 kept (38%)
    assert counts["football goal"] == 1
    goal_dets = [d for d in dets if d["class"] == "football goal"]
    assert len(goal_dets) == 1
    assert goal_dets[0]["confidence"] == 0.38

    # Football: exactly 1 kept (34%)
    assert counts["football"] == 1
    ball_dets = [d for d in dets if d["class"] == "football"]
    assert len(ball_dets) == 1
    assert ball_dets[0]["confidence"] == 0.34

    # Player: exactly 1 kept (27%)
    assert counts["player"] == 1
    player_dets = [d for d in dets if d["class"] == "player"]
    assert len(player_dets) == 1
    assert player_dets[0]["confidence"] == 0.27


def test_background_annotate_endpoint_contract(client):
    """
    Verifies that POST /api/background-annotate accepts parameters,
    creates a background job with 5-second chunk duration and per-class confidences,
    and returns job tracking details.
    """
    payload = {
        "video_filename": "football_match_demo.mp4",
        "chunk_duration": "5.0",
        "confidence_threshold": "0.25",
        "class_confidences": json.dumps({"football goal": 0.35, "football": 0.30, "player": 0.25}),
        "burn_boxes": "true",
    }
    response = client.post("/api/background-annotate", data=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "job_id" in data
    assert data["chunk_duration"] == 5.0
    assert data["class_confidences"]["football goal"] == 0.35

    job_id = data["job_id"]

    # Verify status retrieval
    status_res = client.get(f"/api/background-jobs/{job_id}")
    assert status_res.status_code == 200
    job_status = status_res.json()
    assert job_status["job_id"] == job_id
    assert job_status["status"] in ["processing", "completed"]
    assert "chunks" in job_status


def test_background_jobs_list_endpoint(client):
    """Verifies that GET /api/background-jobs returns jobs array."""
    res = client.get("/api/background-jobs")
    assert res.status_code == 200
    data = res.json()
    assert "jobs" in data
    assert isinstance(data["jobs"], list)


def test_background_job_not_found_404(client):
    """Verifies that nonexistent job ID yields 404."""
    res = client.get("/api/background-jobs/nonexistent-job-uuid-12345")
    assert res.status_code == 404
