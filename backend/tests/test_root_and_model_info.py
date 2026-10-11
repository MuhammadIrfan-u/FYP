from pathlib import Path

from app import main


def test_root_endpoint_success(client):
    """Test GET / returns active status message, model state, and classes."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert "FootballCoach PRO YOLO Analytics API is active" in data["message"]
    assert data["model_loaded"] is True
    assert isinstance(data["classes"], dict)
    assert "player" in data["classes"].values()


def test_root_endpoint_model_unloaded(client, monkeypatch):
    """Test GET / correctly reports when model is unloaded."""
    monkeypatch.setattr(main, "MODEL_LOADED", False)
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["model_loaded"] is False


def test_model_info_endpoint_ready(client):
    """Test GET /api/model-info returns complete model metadata when ready."""
    response = client.get("/api/model-info")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert "model_file" in data
    assert data["format"] in ["onnx", "pytorch"]
    assert data["default_confidence"] == 0.25
    assert isinstance(data["classes"], dict)


def test_model_info_endpoint_error_state(client, monkeypatch):
    """Test GET /api/model-info returns error status when model is not loaded."""
    monkeypatch.setattr(main, "MODEL_LOADED", False)
    response = client.get("/api/model-info")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "error"


def test_model_info_format_pytorch(client, monkeypatch):
    """Test GET /api/model-info accurately detects pytorch format for .pt extension."""
    monkeypatch.setattr(main, "target_model_path", Path("best_5.pt"))
    monkeypatch.setattr(main, "MODEL_LOADED", True)
    response = client.get("/api/model-info")
    assert response.status_code == 200
    data = response.json()
    assert data["format"] == "pytorch"
    assert data["model_file"] == "best_5.pt"


def test_model_info_format_onnx(client, monkeypatch):
    """Test GET /api/model-info accurately detects onnx format for .onnx extension."""
    monkeypatch.setattr(main, "target_model_path", Path("best_5.onnx"))
    monkeypatch.setattr(main, "MODEL_LOADED", True)
    response = client.get("/api/model-info")
    assert response.status_code == 200
    data = response.json()
    assert data["format"] == "onnx"
    assert data["model_file"] == "best_5.onnx"
