import io

from app import main


def test_analyze_frame_json_raw_base64_success(client, sample_base64_image):
    """Test analyzing a frame via JSON with raw base64 string."""
    payload = {
        "image": sample_base64_image,
        "confidence_threshold": 0.25,
    }
    response = client.post("/api/analyze-frame", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "detections" in data
    assert "class_counts" in data
    assert "total_detections" in data
    assert "inference_time_ms" in data
    assert isinstance(data["detections"], list)
    assert data["total_detections"] == len(data["detections"])


def test_analyze_frame_json_data_url_success(client, sample_data_url_image):
    """Test analyzing a frame via JSON with data URI scheme."""
    payload = {
        "image": sample_data_url_image,
        "confidence_threshold": 0.30,
    }
    response = client.post("/api/analyze-frame", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert isinstance(data["detections"], list)


def test_analyze_frame_multipart_form_success(client, sample_image_bytes):
    """Test analyzing a frame uploaded as multipart/form-data."""
    files = {
        "file": ("frame.jpg", io.BytesIO(sample_image_bytes), "image/jpeg"),
    }
    data = {
        "confidence_threshold": "0.35",
    }
    response = client.post("/api/analyze-frame", files=files, data=data)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["success"] is True
    assert "detections" in res_data
    assert "class_counts" in res_data


def test_analyze_frame_invalid_base64(client):
    """Test that invalid base64 string results in a 400 Bad Request error."""
    payload = {
        "image": "not_a_valid_base64_string!@#$%",
    }
    response = client.post("/api/analyze-frame", json=payload)
    assert response.status_code == 400
    assert "Failed to decode base64 JSON frame" in response.json()["detail"]


def test_analyze_frame_corrupt_image_bytes(client):
    """Test that valid base64 with non-image bytes results in 400."""
    import base64

    non_image_b64 = base64.b64encode(b"this is just plain text, not image").decode()
    payload = {"image": non_image_b64}
    response = client.post("/api/analyze-frame", json=payload)
    assert response.status_code == 400
    assert "Invalid or empty image decoded from frame" in response.json()["detail"]


def test_analyze_frame_model_not_initialized(client, sample_base64_image, monkeypatch):
    """Test that 500 is returned when YOLO model is not initialized."""
    monkeypatch.setattr(main, "MODEL_LOADED", False)
    monkeypatch.setattr(main, "model", None)
    payload = {"image": sample_base64_image}
    response = client.post("/api/analyze-frame", json=payload)
    assert response.status_code == 500
    assert "YOLO model is not initialized" in response.json()["detail"]


def test_analyze_frame_custom_confidence_threshold_forwarded(
    client, sample_base64_image, configured_mock_model
):
    """Verify that custom confidence_threshold is passed to model inference."""
    payload = {
        "image": sample_base64_image,
        "confidence_threshold": 0.65,
    }
    response = client.post("/api/analyze-frame", json=payload)
    assert response.status_code == 200
    # configured_mock_model should have been called with conf=0.65
    configured_mock_model.assert_called()
    _, kwargs = configured_mock_model.call_args
    assert kwargs.get("conf") == 0.65
    assert kwargs.get("imgsz") == 480
