from unittest.mock import MagicMock

from app.main import parse_detections
from tests.conftest import MockBox, MockYOLOResult


def test_parse_detections_empty_results():
    """Verify parse_detections handles empty results safely."""
    result = parse_detections([], conf_threshold=0.25)
    assert result["detections"] == []
    assert result["class_counts"] == {
        "player": 0,
        "football": 0,
        "football goal": 0,
        "player with ball": 0,
    }


def test_parse_detections_none_boxes():
    """Verify parse_detections handles results with None boxes."""
    mock_res = MockYOLOResult(boxes=None)
    result = parse_detections([mock_res], conf_threshold=0.25)
    assert result["detections"] == []
    assert result["class_counts"] == {
        "player": 0,
        "football": 0,
        "football goal": 0,
        "player with ball": 0,
    }


def test_parse_detections_empty_boxes():
    """Verify parse_detections handles results with empty boxes list."""
    mock_res = MockYOLOResult(boxes=[])
    result = parse_detections([mock_res], conf_threshold=0.25)
    assert result["detections"] == []
    assert result["class_counts"] == {
        "player": 0,
        "football": 0,
        "football goal": 0,
        "player with ball": 0,
    }


def test_parse_detections_confidence_filtering(configured_mock_model):
    """Verify boxes below the confidence threshold are ignored."""
    boxes = [
        MockBox(cls_id=0, conf=0.80, xywhn=[0.5, 0.5, 0.2, 0.2]),
        MockBox(cls_id=2, conf=0.20, xywhn=[0.3, 0.3, 0.1, 0.1]),
    ]
    res = [MockYOLOResult(boxes=boxes)]

    # At threshold 0.50, only the 0.80 conf detection should be parsed
    parsed = parse_detections(res, conf_threshold=0.50)
    assert len(parsed["detections"]) == 1
    assert parsed["detections"][0]["class"] == "football"
    assert parsed["detections"][0]["confidence"] == 0.80
    assert parsed["class_counts"]["football"] == 1
    assert parsed["class_counts"]["player"] == 0


def test_parse_detections_coordinates_and_percentages(configured_mock_model):
    """Verify bounding box cx, cy, w, h normalized coordinates convert correctly to clamped percentages."""
    # Center at (0.5, 0.5), width 0.4, height 0.2
    # left = 0.5 - 0.2 = 0.3 -> 30%
    # top = 0.5 - 0.1 = 0.4 -> 40%
    # w = 0.4 -> 40%, h = 0.2 -> 20%
    boxes = [MockBox(cls_id=0, conf=0.90, xywhn=[0.5, 0.5, 0.4, 0.2])]
    res = [MockYOLOResult(boxes=boxes)]

    parsed = parse_detections(res, conf_threshold=0.25)
    det = parsed["detections"][0]

    assert det["x"] == 30.0
    assert det["y"] == 40.0
    assert det["w"] == 40.0
    assert det["h"] == 20.0
    assert det["label"] == "Football"


def test_parse_detections_boundary_clamping(configured_mock_model):
    """Verify boxes with extreme coordinates clamp within [0, 100]."""
    # Box centered at 0.0 with width 0.4 -> left would be -0.2 -> clamped to 0.0
    boxes = [MockBox(cls_id=2, conf=0.95, xywhn=[0.0, 0.0, 0.4, 0.4])]
    res = [MockYOLOResult(boxes=boxes)]

    parsed = parse_detections(res, conf_threshold=0.25)
    det = parsed["detections"][0]

    assert det["x"] == 0.0
    assert det["y"] == 0.0


def test_parse_detections_unknown_class(monkeypatch):
    """Verify detection handles classes not in default predefined set."""
    from app import main

    mock_model = MagicMock()
    mock_model.names = {99: "referee"}
    monkeypatch.setattr(main, "model", mock_model)

    boxes = [MockBox(cls_id=99, conf=0.85, xywhn=[0.5, 0.5, 0.1, 0.1])]
    res = [MockYOLOResult(boxes=boxes)]

    parsed = parse_detections(res, conf_threshold=0.25)
    assert len(parsed["detections"]) == 1
    assert parsed["detections"][0]["class"] == "referee"
    assert parsed["class_counts"]["referee"] == 1


def test_parse_detections_model_none(monkeypatch):
    """Verify parse_detections falls back to class_<id> when model is None."""
    from app import main

    monkeypatch.setattr(main, "model", None)

    boxes = [MockBox(cls_id=7, conf=0.75, xywhn=[0.5, 0.5, 0.1, 0.1])]
    res = [MockYOLOResult(boxes=boxes)]

    parsed = parse_detections(res, conf_threshold=0.25)
    assert len(parsed["detections"]) == 1
    assert parsed["detections"][0]["class"] == "class_7"
    assert parsed["class_counts"]["class_7"] == 1
