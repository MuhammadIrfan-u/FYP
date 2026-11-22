"""Jersey-colour team clustering, inter-frame player tracking and ball possession.

Pipeline per processed frame:

1. Sample the pitch turf colour from the lower part of the frame (player boxes masked out).
2. For every ``player`` / ``player with ball`` detection, crop the upper torso, drop pixels
   that match the turf, and take the median colour of what remains (the jersey).
3. Cluster jersey colours into two teams in a chroma-weighted CIE Lab space. With >= 6
   players a k=3 pass first isolates a small outlier cluster (goalkeeper / referee).
   Team centroids are created once, then follow the kits through an EMA so Team 1 and
   Team 2 never swap identity mid-clip.
4. Match detections to persistent tracks (``#1``, ``#2`` ...) with the Hungarian algorithm
   over spatial + colour cost, and smooth each track's team with a majority vote.
5. Run the possession state machine on the ``player with ball`` carrier:
   ``holding`` / ``not_lost`` (same-team pass) / ``lost`` (ball changed team) /
   ``in_transit`` (no carrier visible, previous carrier preserved).

Detections use the API format produced by ``main.parse_detections``: ``x``, ``y``, ``w``,
``h`` are percentages of the frame (top-left origin) and ``class`` is the class name.
"""

from __future__ import annotations

import math
import threading
import time
from collections import Counter, deque
from typing import Any

import cv2
import numpy as np
from scipy.optimize import linear_sum_assignment

from app import model_config

PLAYER_CLASSES = model_config.PLAYER_CLASSES
CARRIER_CLASS = model_config.CARRIER_CLASS
BALL_CLASS = model_config.BALL_CLASS

CARRIER_REACH_HEIGHTS = 0.9
"""How close the ball must be to a player's feet, in player heights, to count
as carried when the model provides no ``player with ball`` class."""

# Torso crop as fractions of the player bounding box.
TORSO_Y_RANGE = (0.19, 0.51)
TORSO_X_RANGE = (0.24, 0.76)

# Lower-field region used to sample turf colour (fractions of the frame).
PITCH_ROI_Y = (0.55, 0.97)
PITCH_ROI_X = (0.04, 0.96)

# Chroma-weighted Lab: Lightness (L*) and yellow-blue warmth (b*) separate bright/warm
# kits (e.g. orange/yellow/red) from dark kits (black/maroon/navy), while green-red (a*)
# is balanced so orange and yellow kits group into the same team.
LAB_WEIGHTS = np.array([1.0, 0.7, 1.2], dtype=np.float64)

# Clustering thresholds, in weighted-Lab units.
MIN_TEAM_SEPARATION = 12.0
MIN_OUTLIER_SEPARATION = 14.0
OUTLIER_MIN_PLAYERS = 6

TEAM_IDS = (1, 2)
OUTLIER_TEAM_ID = 0


# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------


def bgr_to_lab(bgr: np.ndarray) -> np.ndarray:
    """Convert BGR uint8 pixels of shape (..., 3) to CIE Lab (L 0-100, a/b approx -128..127)."""
    arr = np.asarray(bgr, dtype=np.float32).reshape(-1, 1, 3) / 255.0
    lab = cv2.cvtColor(arr, cv2.COLOR_BGR2LAB).reshape(-1, 3)
    return lab.astype(np.float64)


def lab_to_bgr(lab: np.ndarray | list[float]) -> tuple[int, int, int]:
    arr = np.asarray(lab, dtype=np.float32).reshape(1, 1, 3)
    bgr = cv2.cvtColor(arr, cv2.COLOR_LAB2BGR).reshape(3)
    bgr = np.clip(np.round(bgr * 255.0), 0, 255).astype(int)
    return int(bgr[0]), int(bgr[1]), int(bgr[2])


def bgr_to_hex(bgr: tuple[int, int, int] | np.ndarray) -> str:
    b, g, r = (round(float(c)) for c in bgr)
    return f"#{r:02X}{g:02X}{b:02X}"


def hex_to_bgr(hex_color: str | None, default=(200, 200, 200)) -> tuple[int, int, int]:
    if not hex_color or not isinstance(hex_color, str):
        return default
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return default
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        return default
    return b, g, r


def color_name_from_bgr(bgr: tuple[int, int, int] | np.ndarray) -> str:
    """Human-readable colour name for a kit colour."""
    pixel = np.uint8([[[int(bgr[0]), int(bgr[1]), int(bgr[2])]]])
    hue, sat, val = (int(v) for v in cv2.cvtColor(pixel, cv2.COLOR_BGR2HSV)[0, 0])
    lab = bgr_to_lab(np.asarray(bgr, dtype=np.uint8))[0]
    lightness, chroma = lab[0], math.hypot(lab[1], lab[2])

    if chroma < 12 or sat < 40:
        if lightness >= 78:
            return "White"
        if lightness <= 25:
            return "Black"
        return "Gray"

    # OpenCV hue is 0-180.
    if hue < 8 or hue >= 170:
        return "Maroon" if val < 110 else "Red"
    if hue < 20:
        return "Brown" if val < 140 else "Orange"
    if hue < 34:
        return "Yellow"
    if hue < 85:
        return "Green"
    if hue < 100:
        return "Cyan"
    if hue < 130:
        return "Navy" if val < 100 else "Blue"
    if hue < 150:
        return "Purple"
    return "Pink"


def weighted_lab(lab: np.ndarray | list[float]) -> np.ndarray:
    return np.asarray(lab, dtype=np.float64) * LAB_WEIGHTS


def lab_distance(
    lab_a: np.ndarray | list[float], lab_b: np.ndarray | list[float]
) -> float:
    """Chroma-weighted Lab distance (a*/b* weighted higher than L*)."""
    diff = (
        np.asarray(lab_a, dtype=np.float64) - np.asarray(lab_b, dtype=np.float64)
    ) * LAB_WEIGHTS
    return float(np.sqrt(np.sum(diff * diff)))


# ---------------------------------------------------------------------------
# Pitch & jersey extraction
# ---------------------------------------------------------------------------


def _det_to_pixels(
    det: dict[str, Any], width: int, height: int
) -> tuple[int, int, int, int]:
    x1 = round(float(det.get("x", 0.0)) / 100.0 * width)
    y1 = round(float(det.get("y", 0.0)) / 100.0 * height)
    x2 = round((float(det.get("x", 0.0)) + float(det.get("w", 0.0))) / 100.0 * width)
    y2 = round((float(det.get("y", 0.0)) + float(det.get("h", 0.0))) / 100.0 * height)
    x1, y1 = max(0, min(width, x1)), max(0, min(height, y1))
    x2, y2 = max(0, min(width, x2)), max(0, min(height, y2))
    return x1, y1, x2, y2


def estimate_pitch_profile(
    frame_bgr: np.ndarray,
    detections: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Sample the turf colour from the lower field, excluding player boxes.

    Returns the median Lab turf colour plus adaptive tolerances derived from the turf's
    own spread (MAD), so a uniform sage/futsal surface gets a tight mask and a green
    jersey on it is not erased.
    """
    if frame_bgr is None or frame_bgr.size == 0:
        return None
    h, w = frame_bgr.shape[:2]
    y1, y2 = int(h * PITCH_ROI_Y[0]), int(h * PITCH_ROI_Y[1])
    x1, x2 = int(w * PITCH_ROI_X[0]), int(w * PITCH_ROI_X[1])
    if y2 - y1 < 2 or x2 - x1 < 2:
        return None

    keep = np.ones((h, w), dtype=bool)
    for det in detections or []:
        if str(det.get("class", "")).lower().strip() in (*PLAYER_CLASSES, BALL_CLASS):
            bx1, by1, bx2, by2 = _det_to_pixels(det, w, h)
            keep[by1:by2, bx1:bx2] = False

    roi = frame_bgr[y1:y2, x1:x2]
    roi_keep = keep[y1:y2, x1:x2]
    pixels = roi[roi_keep]
    if pixels.shape[0] < 50:
        pixels = roi.reshape(-1, 3)
    if pixels.shape[0] < 50:
        return None

    # Subsample for speed on large frames.
    if pixels.shape[0] > 20000:
        step = pixels.shape[0] // 20000 + 1
        pixels = pixels[::step]

    lab = bgr_to_lab(pixels)
    median = np.median(lab, axis=0)
    mad = np.median(np.abs(lab - median), axis=0)
    mad_ab = float(math.hypot(mad[1], mad[2]))

    return {
        "lab": median.tolist(),
        "tol_ab": float(np.clip(3.0 * mad_ab + 3.0, 6.0, 14.0)),
        "tol_l": float(np.clip(3.0 * float(mad[0]) + 6.0, 12.0, 30.0)),
        "hex": bgr_to_hex(lab_to_bgr(median)),
    }


def extract_player_jersey_color(
    frame_bgr: np.ndarray,
    det: dict[str, Any],
    pitch_profile: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Median jersey colour from the upper-torso crop with turf pixels masked out."""
    if frame_bgr is None or frame_bgr.size == 0:
        return None
    h, w = frame_bgr.shape[:2]
    bx1, by1, bx2, by2 = _det_to_pixels(det, w, h)
    bw, bh = bx2 - bx1, by2 - by1
    if bw < 2 or bh < 3:
        return None

    cy1 = by1 + int(bh * TORSO_Y_RANGE[0])
    cy2 = by1 + max(int(bh * TORSO_Y_RANGE[1]), int(bh * TORSO_Y_RANGE[0]) + 1)
    cx1 = bx1 + int(bw * TORSO_X_RANGE[0])
    cx2 = bx1 + max(int(bw * TORSO_X_RANGE[1]), int(bw * TORSO_X_RANGE[0]) + 1)
    crop = frame_bgr[cy1:cy2, cx1:cx2]
    if crop.size == 0:
        return None

    pixels = crop.reshape(-1, 3)
    lab = bgr_to_lab(pixels)
    keep = np.ones(len(pixels), dtype=bool)

    if pitch_profile:
        turf = np.asarray(pitch_profile["lab"], dtype=np.float64)
        d_ab = np.hypot(lab[:, 1] - turf[1], lab[:, 2] - turf[2])
        d_l = np.abs(lab[:, 0] - turf[0])
        keep = ~((d_ab <= pitch_profile["tol_ab"]) & (d_l <= pitch_profile["tol_l"]))

        # Jersey very close to the turf colour: rather than erase it, keep the
        # pixels that differ most from the turf.
        if keep.sum() < max(4, int(0.15 * len(pixels))):
            dist = np.sqrt(np.sum(((lab - turf) * LAB_WEIGHTS) ** 2, axis=1))
            cutoff = np.quantile(dist, 0.6)
            keep = dist >= cutoff

    kept = pixels[keep]
    if kept.shape[0] == 0:
        kept = pixels

    median_bgr = np.median(kept, axis=0)
    # Plain Python ints regardless of NumPy version (keeps the payload JSON-safe).
    b, g, r = (int(v) for v in np.round(median_bgr))
    bgr = (b, g, r)
    jersey_lab = bgr_to_lab(np.asarray(bgr, dtype=np.uint8))[0]

    return {
        "bgr": list(bgr),
        "lab": [round(float(v), 3) for v in jersey_lab],
        "hex": bgr_to_hex(bgr),
        "name": color_name_from_bgr(bgr),
        "pixel_count": int(kept.shape[0]),
        "pitch_masked_ratio": round(1.0 - float(keep.mean()), 3),
    }


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------


def kmeans_lab(
    labs: np.ndarray | list[list[float]],
    k: int,
    n_iter: int = 30,
    n_init: int = 4,
    seed: int = 42,
) -> tuple[np.ndarray, np.ndarray]:
    """Deterministic k-means (k-means++ init, fixed seed) in chroma-weighted Lab.

    Returns (centroids in plain Lab, labels).
    """
    points = np.asarray(labs, dtype=np.float64).reshape(-1, 3)
    n = len(points)
    if n == 0:
        return np.zeros((0, 3)), np.zeros(0, dtype=int)
    k = max(1, min(k, n))
    feats = points * LAB_WEIGHTS
    rng = np.random.default_rng(seed)

    best_inertia = math.inf
    best_centers = feats[:k].copy()
    best_labels = np.zeros(n, dtype=int)

    for _ in range(n_init):
        centers = [feats[rng.integers(n)]]
        for _c in range(1, k):
            d2 = np.min(
                ((feats[:, None, :] - np.asarray(centers)[None]) ** 2).sum(-1), axis=1
            )
            total = d2.sum()
            idx = (
                int(rng.integers(n)) if total <= 0 else int(rng.choice(n, p=d2 / total))
            )
            centers.append(feats[idx])
        centers = np.asarray(centers)

        labels = np.zeros(n, dtype=int)
        for _it in range(n_iter):
            dists = ((feats[:, None, :] - centers[None]) ** 2).sum(-1)
            new_labels = np.argmin(dists, axis=1)
            new_centers = centers.copy()
            for j in range(k):
                members = feats[new_labels == j]
                if len(members):
                    new_centers[j] = members.mean(axis=0)
            converged = np.array_equal(new_labels, labels) and np.allclose(
                new_centers, centers
            )
            labels, centers = new_labels, new_centers
            if converged:
                break

        inertia = float(((feats - centers[labels]) ** 2).sum())
        if inertia < best_inertia - 1e-9:
            best_inertia, best_centers, best_labels = inertia, centers, labels

    return best_centers / LAB_WEIGHTS, best_labels


def _centroid_sort_key(lab: np.ndarray) -> tuple[float, float, float]:
    # Deterministic: lighter kit first, then by a*, then b*.
    return (-round(float(lab[0]), 1), round(float(lab[1]), 1), round(float(lab[2]), 1))


def cluster_two_teams_from_colors(
    labs: np.ndarray | list[list[float]],
    min_players_for_outliers: int = OUTLIER_MIN_PLAYERS,
) -> dict[str, Any]:
    """Group jersey Lab colours into two teams.

    With >= ``min_players_for_outliers`` colours, a k=3 pass first looks for a small,
    well-separated cluster (goalkeeper / referee) and removes it before the two outfield
    centroids are fitted.

    Returns ``{"centroids": [lab1, lab2] | None, "labels": [...], "outlier_indices": [...],
    "separation": float}``; labels are 0/1 for the sorted teams and -1 for outliers.
    """
    points = np.asarray(labs, dtype=np.float64).reshape(-1, 3)
    n = len(points)
    result: dict[str, Any] = {
        "centroids": None,
        "labels": [-1] * n,
        "outlier_indices": [],
        "separation": 0.0,
    }
    if n < 2:
        return result

    inlier_idx = np.arange(n)
    if n >= min_players_for_outliers:
        cents3, labels3 = kmeans_lab(points, 3)
        sizes = np.bincount(labels3, minlength=3)
        small = int(np.argmin(sizes))
        others = [j for j in range(3) if j != small]
        max_outliers = max(1, round(0.25 * n))
        if 0 < sizes[small] <= max_outliers and all(sizes[j] >= 2 for j in others):
            sep_out = min(lab_distance(cents3[small], cents3[j]) for j in others)
            sep_teams = lab_distance(cents3[others[0]], cents3[others[1]])
            if sep_out >= MIN_OUTLIER_SEPARATION and sep_out >= 0.5 * sep_teams:
                inlier_idx = np.where(labels3 != small)[0]
                result["outlier_indices"] = [
                    int(i) for i in np.where(labels3 == small)[0]
                ]

    inliers = points[inlier_idx]
    cents2, labels2 = kmeans_lab(inliers, 2)
    if len(cents2) < 2:
        return result

    order = sorted(range(2), key=lambda j: _centroid_sort_key(cents2[j]))
    remap = {old: new for new, old in enumerate(order)}
    labels = [-1] * n
    for pos, idx in enumerate(inlier_idx):
        labels[int(idx)] = remap[int(labels2[pos])]

    result["centroids"] = [cents2[order[0]].tolist(), cents2[order[1]].tolist()]
    result["labels"] = labels
    result["separation"] = lab_distance(cents2[0], cents2[1])
    return result


# ---------------------------------------------------------------------------
# Tracker
# ---------------------------------------------------------------------------


class _Track:
    __slots__ = (
        "cx",
        "cy",
        "h",
        "hits",
        "lab",
        "last_frame",
        "team_id",
        "track_id",
        "votes",
        "w",
    )

    def __init__(
        self,
        track_id: int,
        box: tuple[float, float, float, float],
        lab,
        frame_idx: int,
        window: int,
    ):
        self.track_id = track_id
        self.cx, self.cy, self.w, self.h = box
        self.lab = None if lab is None else np.asarray(lab, dtype=np.float64)
        self.last_frame = frame_idx
        self.hits = 1
        self.votes: deque[int] = deque(maxlen=window)
        self.team_id: int | None = None

    def update(self, box, lab, frame_idx: int) -> None:
        self.cx, self.cy, self.w, self.h = box
        if lab is not None:
            lab = np.asarray(lab, dtype=np.float64)
            self.lab = lab if self.lab is None else 0.7 * self.lab + 0.3 * lab
        self.last_frame = frame_idx
        self.hits += 1

    def vote(self, team_id: int | None) -> None:
        if team_id is None:
            return
        self.votes.append(team_id)
        counts = Counter(self.votes)
        top = max(counts.values())
        # Majority; ties go to the most recent of the tied teams.
        for t in reversed(self.votes):
            if counts[t] == top:
                self.team_id = t
                break


class TeamPossessionTracker:
    """Stateful per-video/per-session team clustering, tracking and possession."""

    def __init__(
        self,
        ema_alpha: float = 0.05,
        vote_window: int = 5,
        max_track_age_frames: int = 30,
        max_match_distance_pct: float = 12.0,
        color_cost_weight: float = 0.6,
        max_events: int = 300,
    ):
        self.ema_alpha = ema_alpha
        self.vote_window = vote_window
        self.max_track_age_frames = max_track_age_frames
        self.max_match_distance_pct = max_match_distance_pct
        self.color_cost_weight = color_cost_weight
        self.max_events = max_events
        self._lock = threading.RLock()
        self.reset()

    # -- state ------------------------------------------------------------

    def reset(self) -> None:
        with self._lock:
            self.team_centroids: np.ndarray | None = None
            self.tracks: dict[int, _Track] = {}
            self.next_track_id = 1
            self.frame_index = 0
            self.pitch_profile: dict[str, Any] | None = None
            self.prev_player_id: int | None = None
            self.prev_team: int | None = None
            self.frames_held = dict.fromkeys(TEAM_IDS, 0)
            self.losses = dict.fromkeys(TEAM_IDS, 0)
            self.passes = dict.fromkeys(TEAM_IDS, 0)
            self.events: list[dict[str, Any]] = []
            self.event_counter = 0
            self.frames_with_carrier = 0
            self.last_status = "idle"
            self.last_carrier: dict[str, Any] | None = None
            self.last_player_counts = dict.fromkeys(TEAM_IDS, 0)
            self.last_timestamp: float | None = None
            self.last_used_at = time.time()

    # -- team assignment --------------------------------------------------

    def _assign_teams(self, labs: list[np.ndarray]) -> list[int | None]:
        """Raw (per-frame) team for each colour: 1/2, 0 for outlier, None if unknown."""
        n = len(labs)
        if n == 0:
            return []
        cluster = cluster_two_teams_from_colors(labs) if n >= 2 else None
        outliers = set(cluster["outlier_indices"]) if cluster else set()

        if self.team_centroids is None:
            if not cluster or cluster["centroids"] is None:
                return [None] * n
            if cluster["separation"] < MIN_TEAM_SEPARATION:
                return [None] * n  # Probably one kit only; wait for a clearer frame.
            self.team_centroids = np.asarray(cluster["centroids"], dtype=np.float64)

        raw: list[int | None] = []
        members: dict[int, list[np.ndarray]] = {t: [] for t in TEAM_IDS}
        for i, lab in enumerate(labs):
            d = [lab_distance(lab, c) for c in self.team_centroids]
            team = TEAM_IDS[int(np.argmin(d))]
            if i in outliers:
                raw.append(OUTLIER_TEAM_ID)
                continue
            raw.append(team)
            members[team].append(lab)

        # EMA update with a low alpha keeps identities fixed while following lighting drift.
        for idx, team in enumerate(TEAM_IDS):
            if members[team]:
                mean = np.mean(members[team], axis=0)
                self.team_centroids[idx] = (1 - self.ema_alpha) * self.team_centroids[
                    idx
                ] + self.ema_alpha * mean
        return raw

    def _nearest_team(self, lab: np.ndarray | None) -> int | None:
        if lab is None or self.team_centroids is None:
            return None
        d = [lab_distance(lab, c) for c in self.team_centroids]
        return TEAM_IDS[int(np.argmin(d))]

    # -- tracking ---------------------------------------------------------

    def _match_tracks(
        self, boxes: list[tuple[float, float, float, float]], labs: list
    ) -> list[int]:
        track_ids = list(self.tracks.keys())
        assigned: list[int | None] = [None] * len(boxes)
        if track_ids and boxes:
            big = 1e6
            cost = np.full((len(track_ids), len(boxes)), big)
            for ti, tid in enumerate(track_ids):
                tr = self.tracks[tid]
                for di, (cx, cy, w, h) in enumerate(boxes):
                    dist = math.hypot(cx - tr.cx, cy - tr.cy)
                    gate = self.max_match_distance_pct + 0.5 * math.hypot(w, h)
                    if dist > gate:
                        continue
                    c = dist / max(gate, 1e-6)
                    if labs[di] is not None and tr.lab is not None:
                        c += self.color_cost_weight * min(
                            lab_distance(labs[di], tr.lab) / 60.0, 1.0
                        )
                    cost[ti, di] = c
            rows, cols = linear_sum_assignment(cost)
            for r, c in zip(rows, cols, strict=False):
                if cost[r, c] < big:
                    assigned[c] = track_ids[r]

        result: list[int] = []
        for di, tid in enumerate(assigned):
            if tid is None:
                tid = self.next_track_id
                self.next_track_id += 1
                self.tracks[tid] = _Track(
                    tid, boxes[di], labs[di], self.frame_index, self.vote_window
                )
            else:
                self.tracks[tid].update(boxes[di], labs[di], self.frame_index)
            result.append(tid)

        stale = [
            tid
            for tid, tr in self.tracks.items()
            if self.frame_index - tr.last_frame > self.max_track_age_frames
        ]
        for tid in stale:
            del self.tracks[tid]
        return result

    # -- public API -------------------------------------------------------

    def team_label(self, team_id: int | None) -> str:
        if team_id in TEAM_IDS:
            return f"Team {team_id}"
        if team_id == OUTLIER_TEAM_ID:
            return "Other"
        return "Unassigned"

    def team_info(self) -> list[dict[str, Any]]:
        total_held = sum(self.frames_held.values())
        teams = []
        for idx, team in enumerate(TEAM_IDS):
            if self.team_centroids is not None:
                lab = self.team_centroids[idx]
                bgr = lab_to_bgr(lab)
                hex_color, name, lab_list = (
                    bgr_to_hex(bgr),
                    color_name_from_bgr(bgr),
                    [round(float(v), 2) for v in lab],
                )
            else:
                hex_color, name, lab_list = None, None, None
            teams.append(
                {
                    "team_id": team,
                    "label": self.team_label(team),
                    "color_hex": hex_color,
                    "color_name": name,
                    "lab": lab_list,
                    "player_count": self.last_player_counts.get(team, 0),
                    "frames_held": self.frames_held[team],
                    "possession_percent": round(
                        100.0 * self.frames_held[team] / total_held, 1
                    )
                    if total_held
                    else 0.0,
                    "losses": self.losses[team],
                    "passes": self.passes[team],
                }
            )
        return teams

    def _possession_percent(self) -> dict[str, float]:
        total = sum(self.frames_held.values())
        if not total:
            return {"team_1": 0.0, "team_2": 0.0}
        return {
            "team_1": round(100.0 * self.frames_held[1] / total, 1),
            "team_2": round(100.0 * self.frames_held[2] / total, 1),
        }

    def _log_event(
        self, status: str, timestamp: float | None, from_id, from_team, to_id, to_team
    ) -> dict[str, Any]:
        self.event_counter += 1
        if status == "lost":
            desc = f"{self.team_label(from_team)} #{from_id} -> {self.team_label(to_team)} #{to_id}: possession lost"
        else:
            desc = f"{self.team_label(from_team)} #{from_id} -> {self.team_label(to_team)} #{to_id}: same-team pass"
        event = {
            "id": f"evt-{self.event_counter}",
            "frame_index": self.frame_index,
            "timestamp": None if timestamp is None else round(float(timestamp), 3),
            "status": status,
            "possession_lost": status == "lost",
            "from_player_id": from_id,
            "from_team": from_team,
            "to_player_id": to_id,
            "to_team": to_team,
            "description": desc,
        }
        self.events.append(event)
        if len(self.events) > self.max_events:
            self.events = self.events[-self.max_events :]
        return event

    @staticmethod
    def _center(det: dict[str, Any]) -> tuple[float, float]:
        return (
            float(det.get("x", 0.0)) + float(det.get("w", 0.0)) / 2.0,
            float(det.get("y", 0.0)) + float(det.get("h", 0.0)) / 2.0,
        )

    def _pick_carrier(
        self,
        detections: list[dict[str, Any]],
        frame_shape: tuple[int, int] | None = None,
    ) -> dict[str, Any] | None:
        """The player in control of the ball, or ``None``.

        Prefers an explicit ``player with ball`` detection, but the current
        model has no such class, so it falls back to the player whose feet are
        nearest the ball.
        """
        carriers = [
            d
            for d in detections
            if str(d.get("class", "")).lower().strip() == CARRIER_CLASS
        ]
        if not carriers:
            return self._carrier_by_distance(detections, frame_shape)
        if len(carriers) == 1:
            return carriers[0]
        balls = [
            d
            for d in detections
            if str(d.get("class", "")).lower().strip() == BALL_CLASS
        ]
        if balls:
            ball = max(balls, key=lambda b: float(b.get("confidence", 0.0)))
            bx, by = self._center(ball)

            def ball_dist(d):
                cx, _cy = self._center(d)
                feet_y = float(d.get("y", 0.0)) + float(d.get("h", 0.0))
                return math.hypot(cx - bx, feet_y - by)

            return min(carriers, key=ball_dist)
        return max(carriers, key=lambda d: float(d.get("confidence", 0.0)))

    def _carrier_by_distance(
        self,
        detections: list[dict[str, Any]],
        frame_shape: tuple[int, int] | None,
    ) -> dict[str, Any] | None:
        """Nearest player to the ball, when the model has no carrier class.

        Distance is measured in pixels from the ball to the player's ground
        point and expressed in player heights, so the threshold holds whatever
        the camera zoom. Percentages are converted to pixels first: x and y are
        fractions of different frame dimensions, so mixing them directly
        distorts distance on any non-square frame.
        """
        balls = [
            d
            for d in detections
            if str(d.get("class", "")).lower().strip() == BALL_CLASS
        ]
        players = [
            d
            for d in detections
            if str(d.get("class", "")).lower().strip() in PLAYER_CLASSES
        ]
        if not balls or not players:
            return None

        h_px, w_px = frame_shape if frame_shape else (100.0, 100.0)
        ball = max(balls, key=lambda b: float(b.get("confidence", 0.0)))
        bx = (
            (float(ball.get("x", 0.0)) + float(ball.get("w", 0.0)) / 2.0) / 100.0 * w_px
        )
        by = (
            (float(ball.get("y", 0.0)) + float(ball.get("h", 0.0)) / 2.0) / 100.0 * h_px
        )

        best, best_score = None, float("inf")
        for d in players:
            height = float(d.get("h", 0.0)) / 100.0 * h_px
            if height <= 0:
                continue
            feet_x = (
                (float(d.get("x", 0.0)) + float(d.get("w", 0.0)) / 2.0) / 100.0 * w_px
            )
            feet_y = (float(d.get("y", 0.0)) + float(d.get("h", 0.0))) / 100.0 * h_px
            score = math.hypot(feet_x - bx, feet_y - by) / height
            if score < best_score:
                best, best_score = d, score
        return best if best_score <= CARRIER_REACH_HEIGHTS else None

    def process_frame(
        self,
        frame_bgr: np.ndarray,
        detections: list[dict[str, Any]],
        timestamp: float | None = None,
    ) -> dict[str, Any]:
        """Update teams, tracks and possession from one frame.

        Player detections are enriched in place with ``team_id``, ``team_label``,
        ``team_color_hex``, ``team_color_name``, ``jersey_color_hex``,
        ``jersey_color_name``, ``track_id`` and ``has_ball``. Returns the possession state.
        """
        with self._lock:
            self.frame_index += 1
            self.last_used_at = time.time()
            if timestamp is not None:
                self.last_timestamp = float(timestamp)

            players = [
                d
                for d in detections
                if str(d.get("class", "")).lower().strip() in PLAYER_CLASSES
            ]

            profile = estimate_pitch_profile(frame_bgr, detections)
            if profile is not None:
                self.pitch_profile = profile

            colors = [
                extract_player_jersey_color(frame_bgr, d, self.pitch_profile)
                for d in players
            ]
            valid_idx = [i for i, c in enumerate(colors) if c is not None]
            raw_valid = self._assign_teams(
                [np.asarray(colors[i]["lab"]) for i in valid_idx]
            )
            raw_team: list[int | None] = [None] * len(players)
            for pos, i in enumerate(valid_idx):
                raw_team[i] = raw_valid[pos]

            boxes = []
            for d in players:
                cx, cy = self._center(d)
                boxes.append((cx, cy, float(d.get("w", 0.0)), float(d.get("h", 0.0))))
            labs = [None if c is None else np.asarray(c["lab"]) for c in colors]
            track_ids = self._match_tracks(boxes, labs)

            carrier_det = self._pick_carrier(detections, frame_bgr.shape[:2])
            teams_now = self.team_info()
            team_hex = {t["team_id"]: t["color_hex"] for t in teams_now}
            team_name = {t["team_id"]: t["color_name"] for t in teams_now}
            counts = dict.fromkeys(TEAM_IDS, 0)

            for i, det in enumerate(players):
                track = self.tracks.get(track_ids[i])
                if track is not None:
                    track.vote(raw_team[i])
                team = track.team_id if track is not None else raw_team[i]
                if team in counts:
                    counts[team] += 1
                det["track_id"] = track_ids[i]
                det["team_id"] = team
                # Nearest kit even for outliers (e.g. goalkeepers) for pitch analytics.
                det["nearest_team_id"] = (
                    team if team in TEAM_IDS else self._nearest_team(labs[i])
                )
                det["team_label"] = self.team_label(team)
                det["team_color_hex"] = team_hex.get(team)
                det["team_color_name"] = team_name.get(team)
                det["jersey_color_hex"] = colors[i]["hex"] if colors[i] else None
                det["jersey_color_name"] = colors[i]["name"] if colors[i] else None
                det["has_ball"] = det is carrier_det
            self.last_player_counts = counts

            # ---- possession state machine ---------------------------------
            event = None
            carrier: dict[str, Any] | None = None
            prev_player_id, prev_team = self.prev_player_id, self.prev_team

            if carrier_det is not None:
                curr_id = carrier_det.get("track_id")
                curr_team = carrier_det.get("team_id")
                if curr_team not in TEAM_IDS:
                    # Outlier (e.g. goalkeeper) or not yet smoothed: use nearest kit.
                    idx = next(i for i, d in enumerate(players) if d is carrier_det)
                    curr_team = self._nearest_team(labs[idx])

                carrier = {
                    "track_id": curr_id,
                    "team_id": curr_team,
                    "team_label": self.team_label(curr_team),
                    "team_color_hex": team_hex.get(curr_team),
                    "detection_id": carrier_det.get("id"),
                    "confidence": carrier_det.get("confidence"),
                }

                if curr_team is None:
                    status = "holding"  # Teams not established yet.
                elif prev_player_id is None or prev_team is None:
                    status = "holding"
                elif curr_team != prev_team:
                    status = "lost"
                    self.losses[prev_team] += 1
                    event = self._log_event(
                        status, timestamp, prev_player_id, prev_team, curr_id, curr_team
                    )
                elif curr_id != prev_player_id:
                    status = "not_lost"
                    self.passes[curr_team] += 1
                    event = self._log_event(
                        status, timestamp, prev_player_id, prev_team, curr_id, curr_team
                    )
                else:
                    status = "holding"

                if curr_team is not None:
                    self.frames_held[curr_team] += 1
                    self.prev_player_id, self.prev_team = curr_id, curr_team
                self.frames_with_carrier += 1
                curr_player_id = curr_id
            else:
                status = "in_transit" if self.prev_player_id is not None else "idle"
                curr_player_id, curr_team = self.prev_player_id, self.prev_team

            self.last_status = status
            if carrier is not None:
                self.last_carrier = carrier

            return {
                "frame_index": self.frame_index,
                "timestamp": None if timestamp is None else round(float(timestamp), 3),
                "status": status,
                "possession_status": status,
                "possession_lost": status == "lost",
                "carrier": carrier,
                "prev_player_id": prev_player_id,
                "prev_team": prev_team,
                "curr_player_id": curr_player_id,
                "curr_team": curr_team,
                "event": event,
                "teams": self.team_info(),
                "possession_percent": self._possession_percent(),
                "total_losses": sum(self.losses.values()),
                "total_passes": sum(self.passes.values()),
                "teams_ready": self.team_centroids is not None,
            }

    def get_summary(self, max_events: int = 100) -> dict[str, Any]:
        with self._lock:
            return {
                "teams": self.team_info(),
                "possession_percent": self._possession_percent(),
                "total_losses": sum(self.losses.values()),
                "total_passes": sum(self.passes.values()),
                "losses": {f"team_{t}": v for t, v in self.losses.items()},
                "passes": {f"team_{t}": v for t, v in self.passes.items()},
                "events": list(self.events[-max_events:]),
                "frames_processed": self.frame_index,
                "frames_with_carrier": self.frames_with_carrier,
                "current_status": self.last_status,
                "current_carrier": self.last_carrier,
                "teams_ready": self.team_centroids is not None,
                "active_tracks": len(self.tracks),
            }


# ---------------------------------------------------------------------------
# Session store (live frame-by-frame analysis)
# ---------------------------------------------------------------------------

_SESSIONS: dict[str, TeamPossessionTracker] = {}
_SESSIONS_LOCK = threading.Lock()
MAX_SESSIONS = 64
SESSION_IDLE_TTL_SEC = 60 * 60


def get_or_create_session_tracker(
    session_id: str, reset: bool = False
) -> TeamPossessionTracker:
    """Thread-safe lookup of the tracker for a live session (created on first use)."""
    now = time.time()
    with _SESSIONS_LOCK:
        expired = [
            sid
            for sid, t in _SESSIONS.items()
            if now - t.last_used_at > SESSION_IDLE_TTL_SEC
        ]
        for sid in expired:
            del _SESSIONS[sid]

        tracker = _SESSIONS.get(session_id)
        if tracker is None:
            if len(_SESSIONS) >= MAX_SESSIONS:
                oldest = min(_SESSIONS, key=lambda sid: _SESSIONS[sid].last_used_at)
                del _SESSIONS[oldest]
            tracker = TeamPossessionTracker()
            _SESSIONS[session_id] = tracker
        elif reset:
            tracker.reset()
        tracker.last_used_at = now
        return tracker


def reset_session_tracker(session_id: str) -> bool:
    """Reset a session's tracker. Returns True if the session existed."""
    with _SESSIONS_LOCK:
        tracker = _SESSIONS.get(session_id)
    if tracker is None:
        return False
    tracker.reset()
    return True


def clear_all_sessions() -> None:
    with _SESSIONS_LOCK:
        _SESSIONS.clear()
