"""Which detection model the app runs on, and what its classes mean.

Kept in one place because swapping the model touches inference size, the class
names every service filters on, and the per-class confidence defaults - which
were previously hardcoded in seven files.

The active model is ``best_5`` (classes ``football``, ``football goal``,
``player``, ``player with ball``):

* ``best_5.pt`` is tried first and runs at 640, the size it was trained at. On
  real frames it finds ~18% more (small, distant) players than the ONNX export.
* ``best_5.onnx`` is a **static 480x480 export** (input ``[1, 3, 480, 480]``), so
  it must always run at 480; it is ~25% faster on CPU.
* ``improve_model_best.pt`` stays as a last fallback. It has no
  ``player with ball`` class (the carrier is then worked out geometrically, from
  the ball's position relative to each player) and detects referees, which are
  deliberately absent from :data:`PLAYER_CLASSES`.

Environment overrides:

* ``YOLO_MODEL_FILENAME`` - a file in ``backend/assets`` to try before the
  defaults (e.g. ``best_5.onnx`` for speed).
* ``YOLO_INFER_IMGSZ`` - inference size for models that accept any size. Ignored
  for static ONNX exports, which only run at their export size.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger("model_config")

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"

DEFAULT_MODEL_FILENAMES: tuple[str, ...] = (
    "best_5.pt",
    "best_5.onnx",
    "improve_model_best.pt",
)

MODEL_INPUT_SIZES: dict[str, int] = {
    "best_5.pt": 640,  # training size (train_args imgsz: 640)
    "best_5.onnx": 480,  # static export: input [1, 3, 480, 480]
    "improve_model_best.pt": 640,  # training size (args.yaml imgsz: 640)
}
"""Native input size per model file. Each model runs at its own size."""

STATIC_INPUT_MODELS: frozenset[str] = frozenset({"best_5.onnx"})
"""Exports with a fixed input shape: any other inference size would fail."""

DEFAULT_IMGSZ = 640


def model_filenames(env: dict[str, str] | None = None) -> tuple[str, ...]:
    """Model files to try, in order: ``YOLO_MODEL_FILENAME`` first, then defaults."""
    env = os.environ if env is None else env
    override = Path(env.get("YOLO_MODEL_FILENAME", "").strip()).name
    if not override:
        return DEFAULT_MODEL_FILENAMES
    return (override, *(n for n in DEFAULT_MODEL_FILENAMES if n != override))


def resolve_model_filename(
    assets_dir: Path = ASSETS_DIR, env: dict[str, str] | None = None
) -> str:
    """First candidate that exists on disk (the first name if none exist)."""
    names = model_filenames(env)
    for name in names:
        if (assets_dir / name).exists():
            return name
    return names[0]


def infer_imgsz_for(filename: str, env: dict[str, str] | None = None) -> int:
    """Inference size for a model file: its export size if static, else native/env."""
    env = os.environ if env is None else env
    native = MODEL_INPUT_SIZES.get(filename, DEFAULT_IMGSZ)
    if filename in STATIC_INPUT_MODELS:
        return native
    raw = env.get("YOLO_INFER_IMGSZ", "").strip()
    if raw:
        try:
            size = int(raw)
            if size >= 32 and size % 32 == 0:
                return size
        except ValueError:
            pass
        logger.warning(
            "Ignoring invalid YOLO_INFER_IMGSZ=%r (needs a multiple of 32)", raw
        )
    return native


MODEL_FILENAMES: tuple[str, ...] = model_filenames()
"""Model files tried in order; the first that exists is loaded."""

ACTIVE_MODEL_FILENAME: str = resolve_model_filename()

INFER_IMGSZ: int = infer_imgsz_for(ACTIVE_MODEL_FILENAME)
"""Inference resolution of the active model (640 for best_5.pt, 480 for the
static best_5.onnx). Every service reads it from here, so the live frame API,
batch analysis, tiled inference and the 5s chunk worker all agree."""

# --- classes ---------------------------------------------------------------
BALL_CLASS = "football"
GOAL_CLASS = "football goal"
CARRIER_CLASS = "player with ball"
"""Produced by best_5 (the active model). Code must still work without it, for
the improve_model_best.pt fallback."""

PLAYER_CLASSES: tuple[str, ...] = ("player", CARRIER_CLASS)
"""Classes treated as outfield players: team clustering, possession, passes."""

OFFICIAL_CLASSES: tuple[str, ...] = ("referee", "assistant_referee")
"""Match officials. Detected and drawn, but never treated as players."""

COUNTED_CLASSES: tuple[str, ...] = (
    "player",
    CARRIER_CLASS,
    BALL_CLASS,
    GOAL_CLASS,
    *OFFICIAL_CLASSES,
)
"""Seeds the per-class count dictionaries (best_5's four classes, plus officials
for the fallback model). Classes outside this list are still counted; they are
just added on first sight."""

DEFAULT_CLASS_CONFIDENCES: dict[str, float] = {
    "player": 0.25,
    CARRIER_CLASS: 0.25,
    BALL_CLASS: 0.30,
    GOAL_CLASS: 0.35,
    # Only used by the improve_model_best.pt fallback.
    "referee": 0.25,
    "assistant_referee": 0.25,
}

FALLBACK_CLASS_NAMES: dict[int, str] = {
    0: BALL_CLASS,
    1: GOAL_CLASS,
    2: "player",
    3: CARRIER_CLASS,
}
"""best_5's class ids, reported when no model could be loaded so the API still
describes itself."""


def empty_class_counts() -> dict[str, int]:
    """A fresh per-class counter seeded with the classes we expect."""
    return dict.fromkeys(COUNTED_CLASSES, 0)


def is_player(cls_name: str) -> bool:
    return cls_name.lower().strip() in PLAYER_CLASSES


def is_official(cls_name: str) -> bool:
    return cls_name.lower().strip() in OFFICIAL_CLASSES
