import shutil

from app import main


def test_analyze_video_direct_file_upload_success(client, sample_video_path):
    """Test POST /api/analyze-video with direct video file upload."""
    with open(sample_video_path, "rb") as f:
        files = {"file": ("match.mp4", f, "video/mp4")}
        data = {"sample_fps": "2.0", "confidence_threshold": "0.25"}
        response = client.post("/api/analyze-video", files=files, data=data)

    assert response.status_code == 200
    res = response.json()
    assert res["success"] is True
    assert res["filename"].startswith("analyze_")
    assert "video_url" in res
    assert res["duration"] > 0
    assert res["total_frames"] > 0
    assert res["frames_analyzed"] > 0
    assert isinstance(res["timeline"], dict)
    assert "player" in res["peak_class_counts"]
    assert "player" in res["avg_class_counts"]


def test_analyze_video_existing_filename_success(
    client, sample_video_path, temp_uploads_dir
):
    """Test POST /api/analyze-video using previously uploaded filename."""
    dest_name = "cached_match.mp4"
    shutil.copy(sample_video_path, temp_uploads_dir / dest_name)

    data = {
        "video_filename": dest_name,
        "sample_fps": "1.0",
        "confidence_threshold": "0.30",
    }
    response = client.post("/api/analyze-video", data=data)

    assert response.status_code == 200
    res = response.json()
    assert res["success"] is True
    assert res["filename"] == dest_name
    assert res["frames_analyzed"] > 0


def test_analyze_video_nonexistent_filename_404(client):
    """Test POST /api/analyze-video returns 404 when filename does not exist."""
    data = {"video_filename": "non_existent_file_12345.mp4"}
    response = client.post("/api/analyze-video", data=data)
    assert response.status_code == 404
    assert "Specified video file not found" in response.json()["detail"]


def test_analyze_video_missing_both_inputs_400(client):
    """Test POST /api/analyze-video returns 400 when neither file nor video_filename is provided."""
    data = {"sample_fps": "2.0"}
    response = client.post("/api/analyze-video", data=data)
    assert response.status_code == 400
    assert "Provide either a video file or video_filename" in response.json()["detail"]


def test_analyze_video_unopenable_file_400(client, temp_uploads_dir):
    """Test POST /api/analyze-video returns 400 when file cannot be opened by cv2."""
    bad_file = temp_uploads_dir / "invalid_video.mp4"
    bad_file.write_text("not a real video file format")

    data = {"video_filename": "invalid_video.mp4"}
    response = client.post("/api/analyze-video", data=data)
    assert response.status_code == 400
    assert "Failed to open video file" in response.json()["detail"]


def test_analyze_video_model_not_initialized_500(
    client, sample_video_path, monkeypatch
):
    """Test POST /api/analyze-video returns 500 when YOLO model is uninitialized."""
    monkeypatch.setattr(main, "MODEL_LOADED", False)
    monkeypatch.setattr(main, "model", None)

    with open(sample_video_path, "rb") as f:
        files = {"file": ("match.mp4", f, "video/mp4")}
        response = client.post("/api/analyze-video", files=files)

    assert response.status_code == 500
    assert "YOLO model is not initialized" in response.json()["detail"]
