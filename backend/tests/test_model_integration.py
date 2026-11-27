"""The app runs on best_5 (football, football goal, player, player with ball).

* ``best_5.pt`` loads first at its 640 training size; ``best_5.onnx`` is a static
  480x480 export and must only ever run at 480.
* ``player with ball`` labels the carrier directly.
* ``improve_model_best.pt`` remains a fallback: it has no carrier class (the
  carrier is then found geometrically) and detects referees, which must never be
  treated as players.
"""

import pathlib
import zipfile

import numpy as np
import pytest

from app import model_config
from app.services.team_possession import TeamPossessionTracker

ASSETS = pathlib.Path(model_config.__file__).resolve().parent.parent / "assets"
BEST_5_CLASSES = {"football", "football goal", "player", "player with ball"}


def _player(x, y, cls="player", w=4.0, h=16.0, conf=0.9):
    return {"class": cls, "confidence": conf, "x": x, "y": y, "w": w, "h": h}


def _ball(x, y):
    return {"class": "football", "confidence": 0.8, "x": x, "y": y, "w": 1.0, "h": 2.0}


# ---------------------------------------------------------------------------
# configuration
# ---------------------------------------------------------------------------


def test_best_5_is_the_active_model():
    assert model_config.MODEL_FILENAMES[:2] == ("best_5.pt", "best_5.onnx")
    assert "improve_model_best.pt" in model_config.MODEL_FILENAMES  # fallback
    assert model_config.ACTIVE_MODEL_FILENAME == "best_5.pt"


def test_inference_runs_at_the_active_models_size():
    assert model_config.INFER_IMGSZ == 640  # best_5.pt training size


def test_static_onnx_export_always_runs_at_its_export_size():
    """best_5.onnx's input is fixed at [1, 3, 480, 480]; 640 would crash it."""
    assert model_config.infer_imgsz_for("best_5.onnx", env={}) == 480
    assert (
        model_config.infer_imgsz_for("best_5.onnx", env={"YOLO_INFER_IMGSZ": "640"})
        == 480
    )


def test_imgsz_override_only_for_dynamic_models():
    assert (
        model_config.infer_imgsz_for("best_5.pt", env={"YOLO_INFER_IMGSZ": "480"})
        == 480
    )
    assert (
        model_config.infer_imgsz_for("best_5.pt", env={"YOLO_INFER_IMGSZ": "500"})
        == 640
    )
    assert (
        model_config.infer_imgsz_for("best_5.pt", env={"YOLO_INFER_IMGSZ": "x"}) == 640
    )


def test_model_filename_env_override(tmp_path):
    env = {"YOLO_MODEL_FILENAME": "best_5.onnx"}
    assert model_config.model_filenames(env)[0] == "best_5.onnx"
    assert len(set(model_config.model_filenames(env))) == 3  # no duplicates
    # Falls back to the next file on disk when the requested one is missing.
    (tmp_path / "best_5.pt").write_bytes(b"")
    assert model_config.resolve_model_filename(tmp_path, env) == "best_5.pt"
    (tmp_path / "best_5.onnx").write_bytes(b"")
    assert model_config.resolve_model_filename(tmp_path, env) == "best_5.onnx"


def test_best_5_classes_and_confidences():
    assert set(model_config.FALLBACK_CLASS_NAMES.values()) == BEST_5_CLASSES
    conf = model_config.DEFAULT_CLASS_CONFIDENCES
    assert conf["player with ball"] == 0.25 and conf["player"] == 0.25
    assert conf["football"] == 0.30 and conf["football goal"] == 0.35
    assert model_config.CARRIER_CLASS in model_config.PLAYER_CLASSES
    assert model_config.is_player("player with ball")


def test_officials_are_not_players():
    """The whole point of the referee classes: they are detected so they can be
    left out of team clustering, possession and passes."""
    for cls in ("referee", "assistant_referee"):
        assert model_config.is_official(cls)
        assert not model_config.is_player(cls)
        assert cls not in model_config.PLAYER_CLASSES
    assert model_config.is_player("player")


def test_class_counts_cover_both_models_classes():
    counts = model_config.empty_class_counts()
    # Active best_5 classes...
    for cls in BEST_5_CLASSES:
        assert cls in counts
    # ...and the fallback model's officials.
    for cls in ("referee", "assistant_referee"):
        assert cls in counts
    assert all(v == 0 for v in counts.values())


@pytest.mark.parametrize("filename", ["best_5.pt", "improve_model_best.pt"])
def test_shipped_models_are_real_checkpoints(filename):
    """Guards the weights files: an earlier upload was a renamed training-run
    archive, which loads as nothing at all."""
    p = ASSETS / filename
    assert p.exists(), f"model missing at {p}"
    with zipfile.ZipFile(p) as z:
        names = z.namelist()
    assert any(n.endswith("data.pkl") for n in names), (
        "not a torch checkpoint - was a training-run .zip renamed to .pt?"
    )


def test_best_5_onnx_input_is_the_480_export():
    ort = pytest.importorskip("onnxruntime")
    session = ort.InferenceSession(
        str(ASSETS / "best_5.onnx"), providers=["CPUExecutionProvider"]
    )
    assert session.get_inputs()[0].shape == [1, 3, 480, 480]
    assert model_config.MODEL_INPUT_SIZES["best_5.onnx"] == 480


# ---------------------------------------------------------------------------
# geometric ball carrier
# ---------------------------------------------------------------------------


def _frame():
    return np.zeros((720, 1280, 3), dtype=np.uint8)


def test_carrier_is_found_without_a_player_with_ball_class():
    """best_5 labelled the carrier directly; this model does not, so possession
    has to come from the ball's position. Without this, possession silently
    stops working altogether."""
    tracker = TeamPossessionTracker()
    near, far = _player(20.0, 40.0), _player(60.0, 40.0)
    # Ball at the first player's feet.
    carrier = tracker._pick_carrier([near, far, _ball(21.5, 55.0)], _frame().shape[:2])
    assert carrier is near

    carrier = tracker._pick_carrier([near, far, _ball(61.5, 55.0)], _frame().shape[:2])
    assert carrier is far


def test_no_carrier_when_the_ball_is_nowhere_near_anyone():
    tracker = TeamPossessionTracker()
    players = [_player(20.0, 40.0), _player(60.0, 40.0)]
    loose = _ball(41.0, 10.0)  # mid-air, far from both
    assert tracker._pick_carrier([*players, loose], _frame().shape[:2]) is None


def test_no_carrier_without_a_ball():
    tracker = TeamPossessionTracker()
    assert tracker._pick_carrier([_player(20.0, 40.0)], _frame().shape[:2]) is None


def test_officials_are_never_picked_as_the_carrier():
    """A referee standing over the ball must not take possession."""
    tracker = TeamPossessionTracker()
    ref = _player(20.0, 40.0, cls="referee")
    player = _player(60.0, 40.0)
    # Ball at the referee's feet, far from the player.
    carrier = tracker._pick_carrier(
        [ref, player, _ball(21.5, 55.0)], _frame().shape[:2]
    )
    assert carrier is None


def test_explicit_carrier_class_still_wins_when_a_model_provides_it():
    """best_5 remains a usable fallback, so its carrier class must still work."""
    tracker = TeamPossessionTracker()
    flagged = _player(60.0, 40.0, cls=model_config.CARRIER_CLASS)
    other = _player(20.0, 40.0)
    carrier = tracker._pick_carrier(
        [other, flagged, _ball(21.5, 55.0)], _frame().shape[:2]
    )
    assert carrier is flagged


def test_distance_is_measured_in_pixels_not_percentages():
    """x and y are percentages of different frame dimensions. Mixing them
    directly makes a wide frame's horizontal distances look much smaller than
    they are, and the carrier comes out wrong."""
    tracker = TeamPossessionTracker()
    # A 2.35:1 frame. Two players the same percentage distance from the ball,
    # one horizontally and one vertically - in pixels the vertical one is far
    # closer, and that is the one that should win.
    shape = (540, 1280)
    horizontal = _player(30.0, 40.0)
    vertical = _player(20.0, 48.0)
    ball = _ball(21.5, 55.0)
    carrier = tracker._pick_carrier([horizontal, vertical, ball], shape)
    assert carrier is vertical
