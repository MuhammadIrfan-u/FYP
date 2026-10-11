import base64
import sys
from pathlib import Path
from unittest.mock import MagicMock

import cv2
import numpy as np
import pytest

# Ensure backend root is on sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Mock torch and ultralytics if not already installed in the environment
if "torch" not in sys.modules:
    mock_torch = MagicMock()
    mock_torch.set_num_threads = MagicMock()
    sys.modules["torch"] = mock_torch

if "ultralytics" not in sys.modules:
    mock_ultralytics = MagicMock()
    sys.modules["ultralytics"] = mock_ultralytics

from fastapi.testclient import TestClient

from app import main


class MockBox:
    """Mock YOLO detection box matching ultralytics API structure."""

    def __init__(self, cls_id: int, conf: float, xywhn: list[float]):
        self.cls = [cls_id]
        self.conf = [conf]
        self.xywhn = [np.array(xywhn)]


class MockYOLOResult:
    """Mock YOLO inference result object."""

    def __init__(self, boxes: list[MockBox]):
        self.boxes = boxes


@pytest.fixture
def mock_detection_boxes():
    """Returns sample detection boxes for testing."""
    return [
        MockBox(cls_id=0, conf=0.88, xywhn=[0.5, 0.5, 0.1, 0.1]),  # football
        MockBox(cls_id=2, conf=0.75, xywhn=[0.2, 0.3, 0.15, 0.4]),  # player
        MockBox(cls_id=3, conf=0.92, xywhn=[0.4, 0.6, 0.2, 0.5]),  # player with ball
        MockBox(
            cls_id=1, conf=0.15, xywhn=[0.8, 0.2, 0.2, 0.3]
        ),  # football goal (low conf)
    ]


@pytest.fixture
def sample_image_bytes():
    """Generates valid JPEG image bytes using OpenCV and NumPy."""
    img = np.zeros((120, 160, 3), dtype=np.uint8)
    # Draw green grass and a white center circle
    img[:] = (34, 139, 34)  # Forest green in BGR
    cv2.circle(img, (80, 60), 25, (255, 255, 255), 2)
    success, encoded = cv2.imencode(".jpg", img)
    assert success
    return encoded.tobytes()


@pytest.fixture
def sample_base64_image(sample_image_bytes):
    """Returns a raw base64 string of a valid image."""
    return base64.b64encode(sample_image_bytes).decode("utf-8")


@pytest.fixture
def sample_data_url_image(sample_base64_image):
    """Returns a data URI formatted base64 image string."""
    return f"data:image/jpeg;base64,{sample_base64_image}"


@pytest.fixture
def sample_video_path(tmp_path):
    """Generates a small valid MP4 video file using OpenCV VideoWriter with multi-codec fallback for CI."""
    video_file = tmp_path / "test_sample.mp4"
    codecs = ["mp4v", "MJPG", "XVID", "avc1"]
    out = None

    for codec in codecs:
        fourcc = cv2.VideoWriter_fourcc(*codec)
        writer = cv2.VideoWriter(str(video_file), fourcc, 10.0, (160, 120))
        if writer.isOpened():
            out = writer
            break

    if out is not None:
        for i in range(15):  # 1.5 seconds at 10 fps
            frame = np.zeros((120, 160, 3), dtype=np.uint8)
            frame[:, :] = (20 + i * 5, 100, 30)
            out.write(frame)
        out.release()

    return video_file


@pytest.fixture
def temp_uploads_dir(tmp_path, monkeypatch):
    """Directs main.UPLOADS_DIR to a temporary directory for isolation."""
    test_uploads = tmp_path / "test_uploads"
    test_uploads.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(main, "UPLOADS_DIR", test_uploads)
    return test_uploads


@pytest.fixture
def configured_mock_model(mock_detection_boxes, monkeypatch):
    """Configures main.model to return consistent detection results."""
    mock_model = MagicMock()
    mock_model.names = {
        0: "football",
        1: "football goal",
        2: "player",
        3: "player with ball",
    }
    # When model is called, return list with one MockYOLOResult
    mock_model.return_value = [MockYOLOResult(mock_detection_boxes)]

    monkeypatch.setattr(main, "model", mock_model)
    monkeypatch.setattr(main, "MODEL_LOADED", True)
    monkeypatch.setattr(main, "MODEL_CLASSES", mock_model.names)
    return mock_model


@pytest.fixture
def client(temp_uploads_dir, configured_mock_model):
    """FastAPI TestClient with isolated uploads and mocked model."""
    return TestClient(main.app)
