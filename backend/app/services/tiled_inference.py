"""Tiled YOLO inference for wide full-field videos (e.g. 4096x1080 panoramas).

The exported model runs at a fixed 480x480 input. Shrinking a 4096 px wide panorama to
480 px makes players a few pixels tall, so wide frames are split into overlapping,
roughly square, full-height tiles. Each tile is inferred separately and the boxes are
merged back with class-wise NMS.

Output detections use the same format as ``main.parse_detections`` (percent of frame).
"""

from __future__ import annotations

import math
import time
from typing import Any

import cv2
import numpy as np

from app import model_config

CLASS_KEYS = model_config.COUNTED_CLASSES
WIDE_ASPECT = 1.9  # frames wider than this (w/h) are tiled
TILE_OVERLAP = 0.15
NMS_IOU = 0.5


def tile_windows(
    width: int, height: int, aspect: float = 1.15
) -> list[tuple[int, int]]:
    """Horizontal (x0, x1) windows covering the frame with overlap."""
    if height <= 0 or width / max(1, height) <= WIDE_ASPECT:
        return [(0, width)]
    tile_w = min(width, round(height * aspect))
    stride = tile_w * (1.0 - TILE_OVERLAP)
    n = max(1, math.ceil((width - tile_w) / stride) + 1)
    if n == 1:
        return [(0, width)]
    step = (width - tile_w) / (n - 1)
    return [(round(i * step), round(i * step) + tile_w) for i in range(n)]


def _threshold_for(
    cls_name: str,
    cls_id: int,
    default: float,
    class_confidences: dict[str, float] | None,
) -> float:
    if class_confidences:
        for k, v in class_confidences.items():
            if k.lower().strip() == cls_name.lower().strip() or str(k) == str(cls_id):
                return float(v)
    return default


def detect_frame(
    model: Any,
    frame: np.ndarray,
    conf_threshold: float = 0.25,
    class_confidences: dict[str, float] | None = None,
    imgsz: int = model_config.INFER_IMGSZ,
) -> dict[str, Any]:
    """Run (tiled when wide) inference and return ``{"detections", "class_counts"}``."""
    h, w = frame.shape[:2]
    min_conf = conf_threshold
    if class_confidences:
        try:
            min_conf = min(
                conf_threshold, *[float(v) for v in class_confidences.values()]
            )
        except (TypeError, ValueError):
            pass

    names = getattr(model, "names", {}) or {}
    boxes: list[list[float]] = []  # x1, y1, x2, y2 in frame px
    scores: list[float] = []
    classes: list[int] = []

    for x0, x1 in tile_windows(w, h):
        tile = frame[:, x0:x1]
        results = model(tile, imgsz=imgsz, conf=min_conf, verbose=False)
        if not results:
            continue
        r = results[0]
        if r.boxes is None or len(r.boxes) == 0:
            continue
        xyxy = (
            r.boxes.xyxy.cpu().numpy()
            if hasattr(r.boxes.xyxy, "cpu")
            else np.asarray(r.boxes.xyxy)
        )
        confs = (
            r.boxes.conf.cpu().numpy()
            if hasattr(r.boxes.conf, "cpu")
            else np.asarray(r.boxes.conf)
        )
        clss = (
            r.boxes.cls.cpu().numpy()
            if hasattr(r.boxes.cls, "cpu")
            else np.asarray(r.boxes.cls)
        )
        tile_w = x1 - x0
        for (bx1, by1, bx2, by2), c, k in zip(xyxy, confs, clss, strict=False):
            # Drop boxes cut by an inner tile edge; the neighbouring tile sees them whole.
            if (x0 > 0 and bx1 <= 2) or (x1 < w and bx2 >= tile_w - 2):
                continue
            boxes.append([float(bx1) + x0, float(by1), float(bx2) + x0, float(by2)])
            scores.append(float(c))
            classes.append(int(k))

    keep = _classwise_nms(boxes, scores, classes)
    detections = []
    class_counts = dict.fromkeys(CLASS_KEYS, 0)
    stamp = int(time.time() * 1000) % 100000
    for out_idx, i in enumerate(keep):
        cls_id = classes[i]
        cls_name = (
            names.get(cls_id, f"class_{cls_id}")
            if isinstance(names, dict)
            else str(cls_id)
        )
        if scores[i] < _threshold_for(
            cls_name, cls_id, conf_threshold, class_confidences
        ):
            continue
        x1b, y1b, x2b, y2b = boxes[i]
        x_pct = max(0.0, min(100.0, x1b / w * 100.0))
        y_pct = max(0.0, min(100.0, y1b / h * 100.0))
        w_pct = max(0.0, min(100.0, (x2b - x1b) / w * 100.0))
        h_pct = max(0.0, min(100.0, (y2b - y1b) / h * 100.0))
        class_counts[cls_name] = class_counts.get(cls_name, 0) + 1
        detections.append(
            {
                "id": f"det-{out_idx}-{stamp}",
                "class": cls_name,
                "label": cls_name.capitalize(),
                "confidence": round(scores[i], 3),
                "x": round(x_pct, 3),
                "y": round(y_pct, 3),
                "w": round(w_pct, 3),
                "h": round(h_pct, 3),
            }
        )
    return {"detections": detections, "class_counts": class_counts}


def _classwise_nms(
    boxes: list[list[float]], scores: list[float], classes: list[int]
) -> list[int]:
    keep: list[int] = []
    for cls in set(classes):
        idx = [i for i, c in enumerate(classes) if c == cls]
        rects = [
            [
                boxes[i][0],
                boxes[i][1],
                boxes[i][2] - boxes[i][0],
                boxes[i][3] - boxes[i][1],
            ]
            for i in idx
        ]
        sel = cv2.dnn.NMSBoxes(rects, [scores[i] for i in idx], 0.0, NMS_IOU)
        keep.extend(idx[int(j)] for j in np.asarray(sel).reshape(-1))
    keep.sort(key=lambda i: -scores[i])
    return keep
