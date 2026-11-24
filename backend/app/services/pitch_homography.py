"""Image <-> pitch mapping from user-placed landmarks (homography view).

The user drags named pitch landmarks (corners, penalty-box corners, centre spot, ...)
onto a frame of a full-field video. Each landmark has known pitch coordinates in metres,
so the correspondences give a planar homography ``H`` (image px -> pitch m).

Full-field panoramas (stitched / fisheye cameras) bend straight pitch lines, so a single
homography is only approximately right. With >= ``TPS_MIN_POINTS`` landmarks we fit a
thin-plate-spline on the homography residuals: the mapping then passes through every
landmark exactly and bends smoothly between them.

Pitch coordinate system (metres):
    x: 0 at the left goal line -> ``length`` at the right goal line
    y: 0 at the far touchline (top of the image) -> ``width`` at the near touchline
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from scipy.interpolate import RBFInterpolator

DEFAULT_PITCH_LENGTH = 105.0
DEFAULT_PITCH_WIDTH = 68.0
MIN_POINTS = 4
TPS_MIN_POINTS = 6

# Standard marking dimensions (metres).
PENALTY_AREA_DEPTH = 16.5
PENALTY_AREA_HALF_WIDTH = 20.16
GOAL_AREA_DEPTH = 5.5
GOAL_AREA_HALF_WIDTH = 9.16
PENALTY_SPOT_DIST = 11.0
CENTER_CIRCLE_RADIUS = 9.15
GOAL_HALF_WIDTH = 3.66


def landmark_definitions(
    length: float = DEFAULT_PITCH_LENGTH, width: float = DEFAULT_PITCH_WIDTH
) -> list[dict[str, Any]]:
    """Named landmarks with their pitch coordinates (metres)."""
    L, W = float(length), float(width)
    cy = W / 2.0
    pa_t, pa_b = cy - PENALTY_AREA_HALF_WIDTH, cy + PENALTY_AREA_HALF_WIDTH
    ga_t, ga_b = cy - GOAL_AREA_HALF_WIDTH, cy + GOAL_AREA_HALF_WIDTH
    gp_t, gp_b = cy - GOAL_HALF_WIDTH, cy + GOAL_HALF_WIDTH
    r = CENTER_CIRCLE_RADIUS

    defs: list[tuple[str, str, str, float, float]] = [
        # id, label, group, x, y
        ("corner_tl", "Corner (far-left)", "corners", 0, 0),
        ("corner_tr", "Corner (far-right)", "corners", L, 0),
        ("corner_bl", "Corner (near-left)", "corners", 0, W),
        ("corner_br", "Corner (near-right)", "corners", L, W),
        ("half_top", "Halfway line × far touchline", "centre", L / 2, 0),
        ("half_bottom", "Halfway line × near touchline", "centre", L / 2, W),
        ("center_spot", "Centre spot", "centre", L / 2, cy),
        ("circle_top", "Centre circle (far)", "centre", L / 2, cy - r),
        ("circle_bottom", "Centre circle (near)", "centre", L / 2, cy + r),
        ("circle_left", "Centre circle (left)", "centre", L / 2 - r, cy),
        ("circle_right", "Centre circle (right)", "centre", L / 2 + r, cy),
    ]
    for side, x0, sign in (("left", 0.0, 1.0), ("right", L, -1.0)):
        S = side.capitalize()
        defs += [
            (
                f"{side}_pa_top_line",
                f"{S} penalty box × goal line (far)",
                side,
                x0,
                pa_t,
            ),
            (
                f"{side}_pa_top",
                f"{S} penalty box corner (far)",
                side,
                x0 + sign * PENALTY_AREA_DEPTH,
                pa_t,
            ),
            (
                f"{side}_pa_bottom",
                f"{S} penalty box corner (near)",
                side,
                x0 + sign * PENALTY_AREA_DEPTH,
                pa_b,
            ),
            (
                f"{side}_pa_bottom_line",
                f"{S} penalty box × goal line (near)",
                side,
                x0,
                pa_b,
            ),
            (f"{side}_ga_top_line", f"{S} goal area × goal line (far)", side, x0, ga_t),
            (
                f"{side}_ga_top",
                f"{S} goal area corner (far)",
                side,
                x0 + sign * GOAL_AREA_DEPTH,
                ga_t,
            ),
            (
                f"{side}_ga_bottom",
                f"{S} goal area corner (near)",
                side,
                x0 + sign * GOAL_AREA_DEPTH,
                ga_b,
            ),
            (
                f"{side}_ga_bottom_line",
                f"{S} goal area × goal line (near)",
                side,
                x0,
                ga_b,
            ),
            (
                f"{side}_penalty_spot",
                f"{S} penalty spot",
                side,
                x0 + sign * PENALTY_SPOT_DIST,
                cy,
            ),
            (f"{side}_post_top", f"{S} goal post (far)", side, x0, gp_t),
            (f"{side}_post_bottom", f"{S} goal post (near)", side, x0, gp_b),
        ]
    return [
        {
            "id": i,
            "label": lbl,
            "group": g,
            "x": round(float(x), 3),
            "y": round(float(y), 3),
        }
        for i, lbl, g, x, y in defs
    ]


def pitch_line_segments(
    length: float = DEFAULT_PITCH_LENGTH,
    width: float = DEFAULT_PITCH_WIDTH,
    step: float = 1.0,
) -> list[np.ndarray]:
    """Pitch markings as densely sampled polylines (metres), for overlays/minimaps."""
    L, W = float(length), float(width)
    cy = W / 2.0

    def line(p0, p1):
        n = max(2, int(math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / step) + 1)
        return np.linspace(p0, p1, n)

    def poly(points):
        return np.vstack(
            [line(points[i], points[i + 1]) for i in range(len(points) - 1)]
        )

    def arc(cx, cyy, r, a0, a1):
        n = max(8, int(abs(a1 - a0) * r / step))
        a = np.linspace(a0, a1, n)
        return np.stack([cx + r * np.cos(a), cyy + r * np.sin(a)], axis=1)

    segs = [
        poly([(0, 0), (L, 0), (L, W), (0, W), (0, 0)]),
        line((L / 2, 0), (L / 2, W)),
        arc(L / 2, cy, CENTER_CIRCLE_RADIUS, 0, 2 * math.pi),
    ]
    for x0, s in ((0.0, 1.0), (L, -1.0)):
        segs.append(
            poly(
                [
                    (x0, cy - PENALTY_AREA_HALF_WIDTH),
                    (x0 + s * PENALTY_AREA_DEPTH, cy - PENALTY_AREA_HALF_WIDTH),
                    (x0 + s * PENALTY_AREA_DEPTH, cy + PENALTY_AREA_HALF_WIDTH),
                    (x0, cy + PENALTY_AREA_HALF_WIDTH),
                ]
            )
        )
        segs.append(
            poly(
                [
                    (x0, cy - GOAL_AREA_HALF_WIDTH),
                    (x0 + s * GOAL_AREA_DEPTH, cy - GOAL_AREA_HALF_WIDTH),
                    (x0 + s * GOAL_AREA_DEPTH, cy + GOAL_AREA_HALF_WIDTH),
                    (x0, cy + GOAL_AREA_HALF_WIDTH),
                ]
            )
        )
        # Penalty arc: part of the r=9.15 circle around the spot outside the box.
        spot_x = x0 + s * PENALTY_SPOT_DIST
        half = math.acos(
            (PENALTY_AREA_DEPTH - PENALTY_SPOT_DIST) / CENTER_CIRCLE_RADIUS
        )
        base = 0.0 if s > 0 else math.pi
        segs.append(arc(spot_x, cy, CENTER_CIRCLE_RADIUS, base - half, base + half))
    return segs


class PitchMapper:
    """Maps image pixels to pitch metres (and back) from landmark correspondences."""

    def __init__(
        self,
        image_points: np.ndarray | list,
        pitch_points: np.ndarray | list,
        image_size: tuple[int, int],
        pitch_length: float = DEFAULT_PITCH_LENGTH,
        pitch_width: float = DEFAULT_PITCH_WIDTH,
        landmark_ids: list[str] | None = None,
        use_tps: bool = True,
    ):
        self.image_points = np.asarray(image_points, dtype=np.float64).reshape(-1, 2)
        self.pitch_points = np.asarray(pitch_points, dtype=np.float64).reshape(-1, 2)
        if len(self.image_points) != len(self.pitch_points):
            raise ValueError("image_points and pitch_points must have the same length")
        if len(self.image_points) < MIN_POINTS:
            raise ValueError(f"At least {MIN_POINTS} landmarks are required")
        self.image_width, self.image_height = int(image_size[0]), int(image_size[1])
        self.pitch_length = float(pitch_length)
        self.pitch_width = float(pitch_width)
        self.landmark_ids = list(landmark_ids or [])
        self.use_tps = bool(use_tps) and len(self.image_points) >= TPS_MIN_POINTS
        self._fit()

    # -- fitting ----------------------------------------------------------

    def _norm_img(self, pts: np.ndarray) -> np.ndarray:
        scale = float(max(self.image_width, self.image_height, 1))
        return np.asarray(pts, dtype=np.float64).reshape(-1, 2) / scale

    def _fit(self) -> None:
        if _is_degenerate(self.pitch_points) or _is_degenerate(self.image_points):
            raise ValueError(
                "Landmarks are (nearly) collinear; spread them over the pitch "
                "(e.g. both touchlines and both halves)."
            )
        H, _ = cv2.findHomography(self.image_points, self.pitch_points, 0)
        if H is None or not np.all(np.isfinite(H)):
            raise ValueError("Could not compute a homography from these landmarks")
        self.H = H
        self.H_inv = np.linalg.inv(H)

        self._fwd_rbf = None
        self._inv_rbf = None
        if self.use_tps:
            res_fwd = self.pitch_points - _apply_h(self.H, self.image_points)
            self._fwd_rbf = RBFInterpolator(
                self._norm_img(self.image_points), res_fwd, kernel="thin_plate_spline"
            )
            res_inv = self._norm_img(self.image_points) - self._norm_img(
                _apply_h(self.H_inv, self.pitch_points)
            )
            self._inv_rbf = RBFInterpolator(
                self.pitch_points / 100.0, res_inv, kernel="thin_plate_spline"
            )

    # -- mapping ----------------------------------------------------------

    def image_to_pitch(self, pts: np.ndarray | list) -> np.ndarray:
        p = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
        if len(p) == 0:
            return p
        out = _apply_h(self.H, p)
        if self._fwd_rbf is not None:
            out = out + self._fwd_rbf(self._norm_img(p))
        return out

    def pitch_to_image(self, pts: np.ndarray | list) -> np.ndarray:
        p = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
        if len(p) == 0:
            return p
        out = _apply_h(self.H_inv, p)
        if self._inv_rbf is not None:
            scale = float(max(self.image_width, self.image_height, 1))
            out = out + self._inv_rbf(p / 100.0) * scale
        return out

    def is_on_pitch(self, xy: np.ndarray | tuple, margin: float = 0.0) -> bool:
        x, y = float(xy[0]), float(xy[1])
        return (
            -margin <= x <= self.pitch_length + margin
            and -margin <= y <= self.pitch_width + margin
        )

    # -- quality ----------------------------------------------------------

    def quality(self) -> dict[str, Any]:
        """Residuals (metres) of the plain homography and leave-one-out error."""
        h_res = np.linalg.norm(
            self.pitch_points - _apply_h(self.H, self.image_points), axis=1
        )
        loo = []
        n = len(self.image_points)
        if n > MIN_POINTS:
            for i in range(n):
                keep = [j for j in range(n) if j != i]
                try:
                    m = PitchMapper(
                        self.image_points[keep],
                        self.pitch_points[keep],
                        (self.image_width, self.image_height),
                        self.pitch_length,
                        self.pitch_width,
                        use_tps=self.use_tps,
                    )
                except ValueError:
                    continue
                pred = m.image_to_pitch(self.image_points[i : i + 1])[0]
                loo.append(float(np.linalg.norm(pred - self.pitch_points[i])))
        per_point = [
            {
                "id": self.landmark_ids[i] if i < len(self.landmark_ids) else str(i),
                "homography_error_m": round(float(h_res[i]), 2),
                "loo_error_m": round(loo[i], 2) if len(loo) == n else None,
            }
            for i in range(n)
        ]
        return {
            "points": n,
            "model": "homography+tps" if self.use_tps else "homography",
            "homography_rmse_m": round(float(np.sqrt(np.mean(h_res**2))), 2),
            "loo_rmse_m": round(float(np.sqrt(np.mean(np.square(loo)))), 2)
            if loo
            else None,
            "per_point": per_point,
        }

    def overlay_lines_pct(self) -> list[list[list[float]]]:
        """Pitch markings projected into the image as polylines in % of frame size."""
        out = []
        w, h = max(1, self.image_width), max(1, self.image_height)
        for seg in pitch_line_segments(self.pitch_length, self.pitch_width):
            img = self.pitch_to_image(seg)
            pts = [
                [round(float(x) / w * 100.0, 3), round(float(y) / h * 100.0, 3)]
                for x, y in img
                if np.isfinite(x) and np.isfinite(y)
            ]
            if len(pts) >= 2:
                out.append(pts)
        return out

    # -- (de)serialisation --------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": 1,
            "image_width": self.image_width,
            "image_height": self.image_height,
            "pitch_length": self.pitch_length,
            "pitch_width": self.pitch_width,
            "use_tps": self.use_tps,
            "homography": self.H.tolist(),
            "points": [
                {
                    "id": self.landmark_ids[i]
                    if i < len(self.landmark_ids)
                    else str(i),
                    "image": [float(a) for a in self.image_points[i]],
                    "pitch": [float(a) for a in self.pitch_points[i]],
                }
                for i in range(len(self.image_points))
            ],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PitchMapper:
        pts = data.get("points") or []
        return cls(
            [p["image"] for p in pts],
            [p["pitch"] for p in pts],
            (int(data["image_width"]), int(data["image_height"])),
            float(data.get("pitch_length", DEFAULT_PITCH_LENGTH)),
            float(data.get("pitch_width", DEFAULT_PITCH_WIDTH)),
            landmark_ids=[p.get("id", str(i)) for i, p in enumerate(pts)],
            use_tps=bool(data.get("use_tps", True)),
        )

    def scaled_to(self, width: int, height: int) -> PitchMapper:
        """Same calibration for a frame of a different resolution (same aspect)."""
        if width == self.image_width and height == self.image_height:
            return self
        sx = width / max(1, self.image_width)
        sy = height / max(1, self.image_height)
        return PitchMapper(
            self.image_points * np.array([sx, sy]),
            self.pitch_points,
            (width, height),
            self.pitch_length,
            self.pitch_width,
            landmark_ids=self.landmark_ids,
            use_tps=self.use_tps,
        )


def _apply_h(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    p = np.hstack([pts, np.ones((len(pts), 1))]) @ H.T
    w = p[:, 2:3]
    w = np.where(np.abs(w) < 1e-12, 1e-12, w)
    return p[:, :2] / w


def _is_degenerate(pts: np.ndarray) -> bool:
    """True when the points are (nearly) collinear."""
    c = pts - pts.mean(axis=0)
    s = np.linalg.svd(c, compute_uv=False)
    return s[0] <= 1e-9 or (s[1] / s[0]) < 0.02


def build_mapper_from_landmarks(
    points: list[dict[str, Any]],
    image_width: int,
    image_height: int,
    pitch_length: float = DEFAULT_PITCH_LENGTH,
    pitch_width: float = DEFAULT_PITCH_WIDTH,
) -> PitchMapper:
    """Points are ``{"id": landmark_id, "x": px, "y": px}`` (or custom ``pitch_x/pitch_y``)."""
    defs = {d["id"]: d for d in landmark_definitions(pitch_length, pitch_width)}
    img, pitch, ids = [], [], []
    seen = set()
    for p in points:
        lid = str(p.get("id", ""))
        if lid in seen:
            raise ValueError(f"Landmark '{lid}' placed twice")
        seen.add(lid)
        if "pitch_x" in p and "pitch_y" in p:
            px, py = float(p["pitch_x"]), float(p["pitch_y"])
        elif lid in defs:
            px, py = defs[lid]["x"], defs[lid]["y"]
        else:
            raise ValueError(f"Unknown landmark '{lid}'")
        img.append([float(p["x"]), float(p["y"])])
        pitch.append([px, py])
        ids.append(lid)
    return PitchMapper(
        img,
        pitch,
        (image_width, image_height),
        pitch_length,
        pitch_width,
        landmark_ids=ids,
    )


# ---------------------------------------------------------------------------
# Persistence (one calibration per uploaded video)
# ---------------------------------------------------------------------------


def calibration_path(calib_dir: Path, video_filename: str) -> Path:
    safe = "".join(
        c if c.isalnum() or c in "._-" else "_" for c in Path(video_filename).name
    )
    return calib_dir / f"{safe}.homography.json"


def save_calibration(calib_dir: Path, video_filename: str, mapper: PitchMapper) -> Path:
    calib_dir.mkdir(parents=True, exist_ok=True)
    path = calibration_path(calib_dir, video_filename)
    data = mapper.to_dict()
    data["video_filename"] = Path(video_filename).name
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return path


def load_calibration(calib_dir: Path, video_filename: str) -> PitchMapper | None:
    path = calibration_path(calib_dir, video_filename)
    if not path.exists():
        return None
    try:
        return PitchMapper.from_dict(json.loads(path.read_text(encoding="utf-8")))
    except (ValueError, KeyError, json.JSONDecodeError):
        return None
