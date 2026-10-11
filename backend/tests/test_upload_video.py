from unittest.mock import patch


def test_upload_video_success(client, sample_video_path, temp_uploads_dir):
    """Test uploading a video file successfully and extracting video metadata."""
    with open(sample_video_path, "rb") as f:
        files = {"file": ("match_highlights.mp4", f, "video/mp4")}
        response = client.post("/api/upload", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["filename"] == "match_highlights.mp4"
    assert data["saved_name"].startswith("match_highlights_")
    assert data["saved_name"].endswith(".mp4")
    assert data["relative_url"] == f"/api/videos/{data['saved_name']}"
    assert data["video_url"] == f"http://127.0.0.1:8000/api/videos/{data['saved_name']}"
    assert data["duration"] >= 0.0
    assert data["fps"] > 0
    assert "x" in data["resolution"]
    assert data["size_bytes"] > 0

    # Verify physical file existence in uploads directory
    saved_file = temp_uploads_dir / data["saved_name"]
    assert saved_file.exists()
    assert saved_file.stat().st_size == data["size_bytes"]


def test_upload_video_filename_sanitization(client, sample_video_path):
    """Test filenames with spaces are converted to underscores in saved_name."""
    with open(sample_video_path, "rb") as f:
        files = {"file": ("my first football match.mp4", f, "video/mp4")}
        response = client.post("/api/upload", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "my first football match.mp4"
    assert data["saved_name"].startswith("my_first_football_match_")


def test_upload_video_failure_handling(client, sample_video_path):
    """Test 500 error returned when an unexpected error occurs during saving."""
    with open(sample_video_path, "rb") as f:
        files = {"file": ("corrupted.mp4", f, "video/mp4")}
        with patch("shutil.copyfileobj", side_effect=OSError("Disk write error")):
            response = client.post("/api/upload", files=files)

    assert response.status_code == 500
    assert "Video upload failed" in response.json()["detail"]
