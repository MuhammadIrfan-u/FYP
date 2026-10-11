def test_static_video_file_serving(client, sample_video_path):
    """Test retrieving an uploaded video file via /api/videos/{filename}."""
    from app.main import BASE_DIR

    original_uploads = BASE_DIR / "uploads"
    original_uploads.mkdir(parents=True, exist_ok=True)
    video_bytes = sample_video_path.read_bytes()
    test_file_name = "test_serve_probe.mp4"
    target_file = original_uploads / test_file_name
    try:
        target_file.write_bytes(video_bytes)
        response = client.get(f"/api/videos/{test_file_name}")
        assert response.status_code == 200
        assert response.content == video_bytes
    finally:
        if target_file.exists():
            target_file.unlink()


def test_static_video_file_not_found(client):
    """Test retrieving non-existent video via static mount returns 404."""
    response = client.get("/api/videos/missing_video_12345.mp4")
    assert response.status_code == 404


def test_cors_headers_present(client):
    """Test that CORS middleware sets Access-Control-Allow-Origin header matching requester when credentials allowed."""
    origin = "http://localhost:3000"
    headers = {"Origin": origin}
    response = client.get("/", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
    assert response.headers.get("access-control-allow-credentials") == "true"


def test_cors_preflight_options(client):
    """Test OPTIONS preflight request handles CORS headers correctly."""
    origin = "http://localhost:3000"
    headers = {
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }
    response = client.options("/api/analyze-frame", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
    assert "POST" in response.headers.get("access-control-allow-methods", "")
