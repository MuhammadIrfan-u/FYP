"""Which detection model the app runs on, and what its classes mean.

Kept in one place because swapping the model touches inference size, the class
names every service filters on, and the per-class confidence defaults - which
were previously hardcoded in seven files.

The current model (``improve_model_best.pt``) differs from the old ``best_5``
in two ways that matter:

* It has **no ``player with ball`` class**. Whoever is carrying the ball is
  worked out geometrically instead, from the ball's position relative to each
  player. ``CARRIER_CLASS`` is still honoured where a model provides it.
* It detects **referees and assistant referees** as their own classes. They are
  deliberately absent from :data:`PLAYER_CLASSES`, so officials are never
  clustered into a team, never counted in possession and never credited with a
  pass.
"""

from __future__ import annotations

# Model files tried in order; the first that exists is loaded.
MODEL_FILENAMES: tuple[str, ...] = (
    "improve_model_best.pt",
    "best_5.onnx",
    "best_5.pt",
)

INFER_IMGSZ = 640
"""Inference resolution. 640 is the size ``improve_model_best.pt`` was trained
at (``args.yaml``: ``imgsz: 640``); running a model at its training size is the
sane default, and it costs about the same per frame as the old 480 ONNX path."""

# --- classes ---------------------------------------------------------------
BALL_CLASS = "football"
GOAL_CLASS = "football goal"
CARRIER_CLASS = "player with ball"
"""Only produced by the older model. Code must work without it."""

PLAYER_CLASSES: tuple[str, ...] = ("player", CARRIER_CLASS)
"""Classes treated as outfield players: team clustering, possession, passes."""

OFFICIAL_CLASSES: tuple[str, ...] = ("referee", "assistant_referee")
"""Match officials. Detected and drawn, but never treated as players."""

COUNTED_CLASSES: tuple[str, ...] = (
    "player",
    BALL_CLASS,
    GOAL_CLASS,
    CARRIER_CLASS,
    *OFFICIAL_CLASSES,
)
"""Seeds the per-class count dictionaries. Classes outside this list are still
counted; they are just added on first sight."""

DEFAULT_CLASS_CONFIDENCES: dict[str, float] = {
    GOAL_CLASS: 0.35,
    BALL_CLASS: 0.30,
    "player": 0.25,
    CARRIER_CLASS: 0.25,
    "referee": 0.25,
    "assistant_referee": 0.25,
}

FALLBACK_CLASS_NAMES: dict[int, str] = {
    0: "assistant_referee",
    1: BALL_CLASS,
    2: GOAL_CLASS,
    3: "player",
    4: "referee",
}
"""Reported when no model could be loaded, so the API still describes itself."""


def empty_class_counts() -> dict[str, int]:
    """A fresh per-class counter seeded with the classes we expect."""
    return dict.fromkeys(COUNTED_CLASSES, 0)


def is_player(cls_name: str) -> bool:
    return cls_name.lower().strip() in PLAYER_CLASSES


def is_official(cls_name: str) -> bool:
    return cls_name.lower().strip() in OFFICIAL_CLASSES
