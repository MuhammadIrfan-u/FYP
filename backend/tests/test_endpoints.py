"""Comprehensive test suite for all backend API endpoints.

Covers:
- GET /
- GET /api/model-info
- POST /api/analyze-frame
- POST /api/upload
- POST /api/analyze-video
- GET /api/videos/{filename}
- GET /openapi.json & GET /docs
Validates HTTP status codes, headers, method restrictions, and response payload schemas
matching the frontend TypeScript contracts (YOLOFrameAnalysisResult, YOLOVideoUploadResult, YOLOVideoAnalysisResult).
"""

import io


# ---------------------------------------------------------------------------
# 1. Endpoint: GET /
# ---------------------------------------------------------------------------
def test_endpoint_root_get_success(client):
    """GET / should return 200 with service welcome metadata."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "FootballCoach PRO YOLO Analytics API is active"
    assert "model_loaded" in data
    assert isinstance(data["classes"], dict)


def test_endpoint_root_method_not_allowed(client):
    """POST / should return 405 Method Not Allowed."""
    response = client.post("/")
    assert response.status_code == 405


# ---------------------------------------------------------------------------
# 2. Endpoint: GET /api/model-info
# ---------------------------------------------------------------------------
def test_endpoint_model_info_get_success(client):
    """GET /api/model-info should return 200 matching frontend checkYOLOStatus contract."""
    response = client.get("/api/model-info")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["ready", "error"]
    assert "model_file" in data
    assert "format" in data
    assert "classes" in data
    assert data["default_confidence"] == 0.25


def test_endpoint_model_info_method_not_allowed(client):
    """POST /api/model-info should return 405 Method Not Allowed."""
    response = client.post("/api/model-info")
    assert response.status_code == 405


# ---------------------------------------------------------------------------
# 3. Endpoint: POST /api/analyze-frame
# ---------------------------------------------------------------------------
def test_endpoint_analyze_frame_json_contract(client, sample_base64_image):
    """POST /api/analyze-frame should match YOLOFrameAnalysisResult frontend interface."""
    payload = {
        "image": sample_base64_image,
        "confidence_threshold": 0.25,
    }
    response = client.post("/api/analyze-frame", json=payload)
    assert response.status_code == 200
    data = response.json()

    # Frontend interface validation
    assert data["success"] is True
    assert isinstance(data["detections"], list)
    assert isinstance(data["class_counts"], dict)
    assert isinstance(data["total_detections"], int)
    assert isinstance(data["inference_time_ms"], (int, float))

    # Required class count keys
    for key in ["player", "football", "football goal", "player with ball"]:
        assert key in data["class_counts"]

    # Each detection must conform to YOLODetectionItem interface
    if data["detections"]:
        det = data["detections"][0]
        for field in ["id", "class", "label", "confidence", "x", "y", "w", "h"]:
            assert field in det


def test_endpoint_analyze_frame_multipart_contract(client, sample_image_bytes):
    """POST /api/analyze-frame via multipart/form-data should return 200 with matching schema."""
    files = {"file": ("input.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
    data = {"confidence_threshold": "0.3"}
    response = client.post("/api/analyze-frame", files=files, data=data)
    assert response.status_code == 200
    res = response.json()
    assert res["success"] is True
    assert "detections" in res


def test_endpoint_analyze_frame_invalid_base64_400(client):
    """POST /api/analyze-frame should return 400 when base64 is corrupt."""
    payload = {"image": "corrupt_data!!!"}
    response = client.post("/api/analyze-frame", json=payload)
    assert response.status_code == 400


def test_endpoint_analyze_frame_method_not_allowed(client):
    """GET /api/analyze-frame should return 405 Method Not Allowed."""
    response = client.get("/api/analyze-frame")
    assert response.status_code == 405


# ---------------------------------------------------------------------------
# 4. Endpoint: POST /api/upload
# ---------------------------------------------------------------------------
def test_endpoint_upload_video_contract(client, sample_video_path):
    """POST /api/upload should match YOLOVideoUploadResult frontend interface."""
    with open(sample_video_path, "rb") as f:
        files = {"file": ("match.mp4", f, "video/mp4")}
        response = client.post("/api/upload", files=files)

    assert response.status_code == 200
    data = response.json()

    # Frontend interface validation
    assert data["success"] is True
    assert data["filename"] == "match.mp4"
    assert isinstance(data["saved_name"], str)
    assert data["video_url"].startswith("http")
    assert data["relative_url"].startswith("/api/videos/")
    assert isinstance(data["duration"], (int, float))
    assert isinstance(data["fps"], (int, float))
    assert isinstance(data["resolution"], str)
    assert isinstance(data["size_bytes"], int)


def test_endpoint_upload_video_missing_file_422(client):
    """POST /api/upload should return 422 Unprocessable Entity when file field is omitted."""
    response = client.post("/api/upload")
    assert response.status_code == 422


def test_endpoint_upload_video_method_not_allowed(client):
    """GET /api/upload should return 405 Method Not Allowed."""
    response = client.get("/api/upload")
    assert response.status_code == 405


# ---------------------------------------------------------------------------
# 5. Endpoint: POST /api/analyze-video
# ---------------------------------------------------------------------------
def test_endpoint_analyze_video_contract(client, sample_video_path):
    """POST /api/analyze-video should match YOLOVideoAnalysisResult frontend interface."""
    with open(sample_video_path, "rb") as f:
        files = {"file": ("gameplay.mp4", f, "video/mp4")}
        data = {"sample_fps": "2.0", "confidence_threshold": "0.25"}
        response = client.post("/api/analyze-video", files=files, data=data)

    assert response.status_code == 200
    data = response.json()

    # Frontend interface validation
    assert data["success"] is True
    assert isinstance(data["filename"], str)
    assert data["video_url"].startswith("http")
    assert isinstance(data["duration"], (int, float))
    assert isinstance(data["total_frames"], int)
    assert isinstance(data["frames_analyzed"], int)
    assert isinstance(data["timeline"], dict)
    assert isinstance(data["peak_class_counts"], dict)
    assert isinstance(data["avg_class_counts"], dict)


def test_endpoint_analyze_video_missing_inputs_400(client):
    """POST /api/analyze-video should return 400 when neither file nor video_filename is provided."""
    response = client.post("/api/analyze-video", data={"sample_fps": "2.0"})
    assert response.status_code == 400


def test_endpoint_analyze_video_nonexistent_file_404(client):
    """POST /api/analyze-video should return 404 when referenced video_filename doesn't exist."""
    response = client.post(
        "/api/analyze-video", data={"video_filename": "nonexistent.mp4"}
    )
    assert response.status_code == 404


def test_endpoint_analyze_video_invalid_fps_type_422(client, sample_video_path):
    """POST /api/analyze-video should return 422 when sample_fps cannot be parsed as float."""
    with open(sample_video_path, "rb") as f:
        files = {"file": ("gameplay.mp4", f, "video/mp4")}
        data = {"sample_fps": "invalid_number"}
        response = client.post("/api/analyze-video", files=files, data=data)
    assert response.status_code == 422


def test_endpoint_analyze_video_method_not_allowed(client):
    """GET /api/analyze-video should return 405 Method Not Allowed."""
    response = client.get("/api/analyze-video")
    assert response.status_code == 405


# ---------------------------------------------------------------------------
# 6. Endpoint: GET /api/videos/{filename}
# ---------------------------------------------------------------------------
def test_endpoint_static_video_serving(client, sample_video_path):
    """GET /api/videos/{filename} should stream saved video files."""
    from app.main import BASE_DIR

    original_uploads = BASE_DIR / "uploads"
    original_uploads.mkdir(parents=True, exist_ok=True)
    test_name = "endpoint_test_stream.mp4"
    target = original_uploads / test_name
    try:
        target.write_bytes(sample_video_path.read_bytes())
        response = client.get(f"/api/videos/{test_name}")
        assert response.status_code == 200
        assert len(response.content) > 0
    finally:
        if target.exists():
            target.unlink()


def test_endpoint_static_video_not_found_404(client):
    """GET /api/videos/{filename} should return 404 for nonexistent files."""
    response = client.get("/api/videos/not_found_clip.mp4")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# 7. Endpoint: GET /openapi.json & GET /docs
# ---------------------------------------------------------------------------
def test_endpoint_openapi_spec(client):
    """GET /openapi.json should return 200 with all declared API endpoint routes."""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    spec = response.json()
    assert spec["info"]["title"] == "FootballCoach PRO - YOLO Analytics Engine"
    paths = spec["paths"]
    assert "/" in paths
    assert "/api/model-info" in paths
    assert "/api/analyze-frame" in paths
    assert "/api/upload" in paths
    assert "/api/analyze-video" in paths


def test_endpoint_swagger_docs(client):
    """GET /docs should return 200 with interactive Swagger UI documentation."""
    response = client.get("/docs")
    assert response.status_code == 200
    assert "swagger-ui" in response.text.lower()
