"""The app runs on improve_model_best.pt, whose classes differ from best_5's.

Two differences drive everything here:

* no ``player with ball`` class - the ball carrier is found geometrically;
* ``referee`` / ``assistant_referee`` exist - officials must never be treated
  as players, or they get clustered into a team and counted in possession.
"""

import zipfile

import numpy as np

from app import model_config
from app.services.team_possession import TeamPossessionTracker


def _player(x, y, cls="player", w=4.0, h=16.0, conf=0.9):
    return {"class": cls, "confidence": conf, "x": x, "y": y, "w": w, "h": h}


def _ball(x, y):
    return {"class": "football", "confidence": 0.8, "x": x, "y": y, "w": 1.0, "h": 2.0}


# ---------------------------------------------------------------------------
# configuration
# ---------------------------------------------------------------------------


def test_inference_runs_at_the_models_training_size():
    assert model_config.INFER_IMGSZ == 640


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
    # New model's classes...
    for cls in ("player", "football", "referee", "assistant_referee"):
        assert cls in counts
    # ...and the old one's, so best_5 still reports sensibly as a fallback.
    assert model_config.CARRIER_CLASS in counts
    assert all(v == 0 for v in counts.values())


def test_shipped_model_is_a_real_checkpoint_with_the_expected_classes():
    """Guards the weights file itself: the original upload was a renamed
    training-run archive, which loads as nothing at all."""
    path = model_config.__file__.rsplit("app", 1)[0] + "assets/improve_model_best.pt"
    import pathlib

    p = pathlib.Path(path)
    assert p.exists(), f"model missing at {p}"
    with zipfile.ZipFile(p) as z:
        names = z.namelist()
    assert any(n.endswith("data.pkl") for n in names), (
        "not a torch checkpoint - was a training-run .zip renamed to .pt?"
    )


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
