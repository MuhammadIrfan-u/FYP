from collections import deque
import logging
import math
import threading
import time
from typing import Any

import cv2
import numpy as np

try:
    from scipy.optimize import linear_sum_assignment

    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

logger = logging.getLogger("team_possession")

PLAYER_CLASSES = {"player", "player with ball"}


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    """Convert an (R, G, B) tuple to a #RRGGBB hex string."""
    r, g, b = (max(0, min(255, int(c))) for c in rgb)
    return f"#{r:02X}{g:02X}{b:02X}"


def lab_to_bgr(lab: np.ndarray) -> tuple[int, int, int]:
    """Convert a single OpenCV CIE Lab color vector (3,) to a (B, G, R) integer tuple."""
    clipped = np.clip(np.round(lab), 0, 255).astype(np.uint8).reshape(1, 1, 3)
    bgr = cv2.cvtColor(clipped, cv2.COLOR_LAB2BGR).reshape(3)
    return (int(bgr[0]), int(bgr[1]), int(bgr[2]))


def describe_color_name(bgr: tuple[int, int, int]) -> str:
    """Return a concise human-readable color label for a (B, G, R) color."""
    arr = np.uint8([[[bgr[0], bgr[1], bgr[2]]]])
    hsv = cv2.cvtColor(arr, cv2.COLOR_BGR2HSV).reshape(3)
    h, s, v = int(hsv[0]), int(hsv[1]), int(hsv[2])

    if v < 50:
        return "Black"
    if s < 42:
        if v > 175:
            return "White"
        if v > 95:
            return "Gray"
        return "Charcoal"

    if h < 10 or h >= 165:
        return "Red"
    if h < 22:
        return "Orange"
    if h < 36:
        return "Yellow"
    if h < 82:
        return "Green"
    if h < 100:
        return "Cyan"
    if h < 130:
        return "Blue"
    if h < 155:
        return "Purple"
    return "Pink"


# Emphasize hue/chroma (a, b) over floodlight/shadow lightness (L) when grouping kits;
# 0.40 * L still keeps ~65+ separation between dark and white achromatic kits.
LAB_CLUSTER_WEIGHTS = np.array([0.40, 1.60, 1.60], dtype=np.float32)


def _to_weighted_lab(lab: np.ndarray) -> np.ndarray:
    """Scale Lab vectors by `LAB_CLUSTER_WEIGHTS` for lighting-resilient distance."""
    return lab * LAB_CLUSTER_WEIGHTS


def estimate_pitch_profile(
    frame_bgr: np.ndarray,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Estimate the frame's median pitch turf (Lab, HSV) from the lower field region."""
    if frame_bgr is None or frame_bgr.size == 0:
        return None
    h, w = frame_bgr.shape[:2]
    roi = frame_bgr[int(0.45 * h) : int(0.92 * h), int(0.08 * w) : int(0.92 * w)]
    if roi.size == 0:
        roi = frame_bgr
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV).reshape(-1, 3)
    bgr = roi.reshape(-1, 3)
    # Candidate turf pixels span yellow-green to emerald-green with non-black brightness
    green_candidates = (hsv[:, 0] >= 22) & (hsv[:, 0] <= 90) & (hsv[:, 2] >= 35)
    if np.count_nonzero(green_candidates) >= 100:
        pts_bgr = bgr[green_candidates]
        pts_hsv = hsv[green_candidates]
    else:
        pts_bgr = bgr
        pts_hsv = hsv
    med_bgr = np.median(pts_bgr, axis=0).astype(np.uint8)
    med_hsv = np.median(pts_hsv, axis=0).astype(np.float32)
    med_lab = (
        cv2.cvtColor(med_bgr.reshape(1, 1, 3), cv2.COLOR_BGR2LAB)
        .reshape(3)
        .astype(np.float32)
    )
    return med_lab, med_hsv


def extract_player_jersey_color(
    frame_bgr: np.ndarray,
    det: dict[str, Any],
    pitch_profile: tuple[np.ndarray, np.ndarray] | None = None,
) -> tuple[np.ndarray, tuple[int, int, int], str] | None:
    """Extract representative torso jersey color (Lab vector, BGR tuple, hex string).

    Crops the upper-torso region of the bounding box and filters out pixels matching
    the frame's pitch color so both stadium grass and green kits work accurately.
    """
    if frame_bgr is None or frame_bgr.size == 0:
        return None

    img_h, img_w = frame_bgr.shape[:2]
    x_pct = float(det.get("x", 0.0))
    y_pct = float(det.get("y", 0.0))
    w_pct = float(det.get("w", 0.0))
    h_pct = float(det.get("h", 0.0))

    x1 = max(0, int((x_pct / 100.0) * img_w))
    y1 = max(0, int((y_pct / 100.0) * img_h))
    x2 = min(img_w, int(((x_pct + w_pct) / 100.0) * img_w))
    y2 = min(img_h, int(((y_pct + h_pct) / 100.0) * img_h))

    box_w = x2 - x1
    box_h = y2 - y1
    if box_w < 2 or box_h < 2:
        return None

    # Torso region: 19%-51% vertically, 24%-76% horizontally
    ty1 = max(0, y1 + int(0.19 * box_h))
    ty2 = min(img_h, max(ty1 + 2, y1 + int(0.51 * box_h)))
    tx1 = max(0, x1 + int(0.24 * box_w))
    tx2 = min(img_w, max(tx1 + 2, x1 + int(0.76 * box_w)))

    crop = frame_bgr[ty1:ty2, tx1:tx2]
    if crop.size == 0:
        crop = frame_bgr[y1:y2, x1:x2]
        if crop.size == 0:
            return None

    if pitch_profile is None:
        pitch_profile = estimate_pitch_profile(frame_bgr)

    crop_bgr = crop.reshape(-1, 3)
    if pitch_profile is not None:
        pitch_lab, pitch_hsv = pitch_profile
        crop_lab = (
            cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
        )
        crop_hsv = (
            cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(np.float32)
        )
        lab_dists = np.linalg.norm(crop_lab - pitch_lab[None, :], axis=1)
        hue_diff = np.abs(crop_hsv[:, 0] - pitch_hsv[0])
        is_pitch = (
            (lab_dists <= 20.0)
            & (hue_diff <= 14.0)
            & (crop_hsv[:, 0] >= 25.0)
            & (crop_hsv[:, 0] <= 90.0)
        )
        non_pitch_pixels = crop_bgr[~is_pitch]
    else:
        non_pitch_pixels = crop_bgr

    total_pixels = len(crop_bgr)
    if len(non_pitch_pixels) >= max(4, int(0.25 * total_pixels)):
        pixels = non_pitch_pixels
    else:
        # Tight center fallback in case team wears a color very close to the pitch
        cy1 = max(0, y1 + int(0.24 * box_h))
        cy2 = min(img_h, max(cy1 + 1, y1 + int(0.47 * box_h)))
        cx1 = max(0, x1 + int(0.30 * box_w))
        cx2 = min(img_w, max(cx1 + 1, x1 + int(0.70 * box_w)))
        tight_crop = frame_bgr[cy1:cy2, cx1:cx2]
        pixels = (tight_crop if tight_crop.size > 0 else crop).reshape(-1, 3)

    median_bgr = np.median(pixels, axis=0).astype(np.uint8)
    bgr_tuple = (int(median_bgr[0]), int(median_bgr[1]), int(median_bgr[2]))
    rgb_tuple = (bgr_tuple[2], bgr_tuple[1], bgr_tuple[0])
    lab_vec = (
        cv2.cvtColor(median_bgr.reshape(1, 1, 3), cv2.COLOR_BGR2LAB)
        .reshape(3)
        .astype(np.float32)
    )
    return lab_vec, bgr_tuple, rgb_to_hex(rgb_tuple)


def kmeans_lab(
    points: np.ndarray,
    k: int,
    n_init: int = 8,
    max_iter: int = 25,
) -> tuple[np.ndarray, np.ndarray, float]:
    """Deterministic multi-seed K-Means++ clustering in pure NumPy."""
    n = len(points)
    if n == 0:
        return np.empty((0, 3), dtype=np.float32), np.empty((0,), dtype=int), 0.0

    k = min(k, n)
    rng = np.random.default_rng(42)

    best_centroids: np.ndarray | None = None
    best_labels: np.ndarray | None = None
    best_inertia = float("inf")

    for attempt in range(n_init):
        # First attempt seeds deterministically from extreme points; subsequent use K-means++
        centroids = np.empty((k, points.shape[1]), dtype=np.float32)
        if attempt == 0:
            first_idx = int(np.argmin(points[:, 0] + points[:, 1]))
        else:
            first_idx = int(rng.integers(0, n))
        centroids[0] = points[first_idx]

        for c_idx in range(1, k):
            dists = np.min(
                np.sum((points[:, None, :] - centroids[None, :c_idx, :]) ** 2, axis=2),
                axis=1,
            )
            total_dist = float(np.sum(dists))
            if total_dist <= 1e-9:
                centroids[c_idx] = points[c_idx % n]
            elif attempt == 0:
                centroids[c_idx] = points[int(np.argmax(dists))]
            else:
                probs = dists / total_dist
                chosen = int(rng.choice(n, p=probs))
                centroids[c_idx] = points[chosen]

        labels = np.zeros(n, dtype=int)
        for _ in range(max_iter):
            sq_dists = np.sum((points[:, None, :] - centroids[None, :, :]) ** 2, axis=2)
            new_labels = np.argmin(sq_dists, axis=1)
            if np.array_equal(new_labels, labels) and _ > 0:
                break
            labels = new_labels
            for c_idx in range(k):
                mask = labels == c_idx
                if np.any(mask):
                    centroids[c_idx] = points[mask].mean(axis=0)

        final_sq = np.sum((points - centroids[labels]) ** 2, axis=1)
        inertia = float(np.sum(final_sq))
        if inertia < best_inertia:
            best_inertia = inertia
            best_centroids = centroids.copy()
            best_labels = labels.copy()

    assert best_centroids is not None and best_labels is not None
    return best_centroids, best_labels, best_inertia


def _sort_centroids(c1: np.ndarray, c2: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Deterministically order two Lab centroids so Team 1 and Team 2 don't flip randomly."""
    key1 = (float(c1[1]), float(c1[2]), float(c1[0]))
    key2 = (float(c2[1]), float(c2[2]), float(c2[0]))
    return (c1, c2) if key1 <= key2 else (c2, c1)


def cluster_two_teams_from_colors(
    lab_colors: np.ndarray,
    min_separation: float = 20.0,
) -> tuple[list[np.ndarray], np.ndarray]:
    """Cluster player jersey Lab colors into at most 2 main team centroids.

    When >= 6 players are present, checks k=3 first to isolate goalkeepers or
    referees as a small outlier cluster so they don't skew the two team centroids.
    """
    n = len(lab_colors)
    if n == 0:
        return [], np.empty((0,), dtype=int)
    if n == 1:
        return [lab_colors[0].copy()], np.zeros(1, dtype=int)

    weighted_colors = _to_weighted_lab(lab_colors)

    # Try k=3 first when enough players exist so GK/referee outliers stay separated
    if n >= 6:
        c3, lbl3, _ = kmeans_lab(weighted_colors, k=3, n_init=8)
        counts3 = np.bincount(lbl3, minlength=3)
        order = np.argsort(-counts3)
        c_top1, c_top2, c_small = c3[order[0]], c3[order[1]], c3[order[2]]
        cnt_top1, cnt_top2, cnt_small = (
            int(counts3[order[0]]),
            int(counts3[order[1]]),
            int(counts3[order[2]]),
        )
        sep_top = float(np.linalg.norm(c_top1 - c_top2))
        if (
            cnt_top1 >= 2
            and cnt_top2 >= 2
            and cnt_small <= max(2, int(0.18 * n))
            and sep_top >= min_separation
        ):
            raw_t1 = c_top1 / LAB_CLUSTER_WEIGHTS
            raw_t2 = c_top2 / LAB_CLUSTER_WEIGHTS
            t1, t2 = _sort_centroids(raw_t1, raw_t2)
            centroids_w = _to_weighted_lab(np.stack([t1, t2], axis=0))
            dists = np.linalg.norm(
                weighted_colors[:, None, :] - centroids_w[None, :, :], axis=2
            )
            labels = np.argmin(dists, axis=1)
            return [t1.copy(), t2.copy()], labels

    # Standard 2-means clustering
    c2, lbl2, _ = kmeans_lab(weighted_colors, k=2, n_init=8)
    if len(c2) < 2:
        return [lab_colors.mean(axis=0)], np.zeros(n, dtype=int)

    sep = float(np.linalg.norm(c2[0] - c2[1]))
    if sep < min_separation:
        # All visible players belong to essentially one jersey color
        return [lab_colors.mean(axis=0)], np.zeros(n, dtype=int)

    raw_c1 = c2[0] / LAB_CLUSTER_WEIGHTS
    raw_c2 = c2[1] / LAB_CLUSTER_WEIGHTS
    t1, t2 = _sort_centroids(raw_c1, raw_c2)
    centroids_w = _to_weighted_lab(np.stack([t1, t2], axis=0))
    dists = np.linalg.norm(
        weighted_colors[:, None, :] - centroids_w[None, :, :], axis=2
    )
    labels = np.argmin(dists, axis=1)
    return [t1.copy(), t2.copy()], labels


class TeamPossessionTracker:
    """Groups players into 2 teams by jersey color and tracks ball possession changes.

    Rules implemented:
    - Model identifies players (`player`) and ball carrier (`player with ball`).
    - Players are grouped into 2 teams based on clothes (jersey) color.
    - When `player with ball` changes team -> possession lost (`possession_lost=True`).
    - When `player with ball` changes player but stays on same team -> possession NOT lost (`possession_lost=False`).
    """

    def __init__(self, max_missed_frames: int = 8) -> None:
        self.max_missed_frames = max_missed_frames
        self.team_centroids: dict[int, np.ndarray] = {}
        self.tracks: dict[int, dict[str, Any]] = {}
        self.next_track_id: int = 1
        self.frame_index: int = 0

        self.prev_carrier_id: int | None = None
        self.prev_carrier_team: int | None = None
        self.possession_frames: dict[int, int] = {1: 0, 2: 0}
        self.team_losses: dict[int, int] = {1: 0, 2: 0}
        self.total_possession_losses: int = 0
        self.total_same_team_passes: int = 0
        self.events: list[dict[str, Any]] = []
        self.last_access: float = time.time()

    def _update_team_centroids(
        self,
        player_labs: list[np.ndarray],
    ) -> list[int]:
        """Assign each extracted player Lab color to Team 1 or Team 2."""
        if not player_labs:
            return []

        labs_arr = np.stack(player_labs, axis=0)

        # Case 1: No centroids learned yet
        if not self.team_centroids:
            centroids, labels = cluster_two_teams_from_colors(labs_arr)
            if len(centroids) >= 1:
                self.team_centroids[1] = centroids[0].copy()
            if len(centroids) >= 2:
                self.team_centroids[2] = centroids[1].copy()
            return [int(lbl) + 1 for lbl in labels]

        # Case 2: Only Team 1 learned so far — check if Team 2 appears now
        if 1 in self.team_centroids and 2 not in self.team_centroids:
            c1 = self.team_centroids[1]
            c1_w = _to_weighted_lab(c1)
            labs_w = _to_weighted_lab(labs_arr)
            dists_to_1 = np.linalg.norm(labs_w - c1_w, axis=1)
            distant_mask = dists_to_1 >= 22.0
            if np.any(distant_mask):
                distant_pts = labs_arr[distant_mask]
                if len(distant_pts) >= 2:
                    c2 = np.median(distant_pts, axis=0).astype(np.float32)
                else:
                    c2 = distant_pts[0].astype(np.float32)
                # Keep Team 1 anchored to its existing centroid so labels never flip
                self.team_centroids[2] = c2

        # Case 3: Only Team 1 still exists (no second distinct color appeared yet)
        if 2 not in self.team_centroids:
            c1 = self.team_centroids[1]
            mean_c = labs_arr.mean(axis=0)
            if float(np.linalg.norm(_to_weighted_lab(mean_c - c1))) < 22.0:
                self.team_centroids[1] = 0.92 * c1 + 0.08 * mean_c
            return [1 for _ in player_labs]

        # Case 4: Both Team 1 and Team 2 exist — assign nearest weighted centroid and smooth EMA
        c1 = self.team_centroids[1]
        c2 = self.team_centroids[2]
        c1_w = _to_weighted_lab(c1)
        c2_w = _to_weighted_lab(c2)
        labs_w = _to_weighted_lab(labs_arr)
        assigned: list[int] = []
        t1_updates: list[np.ndarray] = []
        t2_updates: list[np.ndarray] = []

        for lab, lab_w in zip(labs_arr, labs_w, strict=False):
            d1 = float(np.linalg.norm(lab_w - c1_w))
            d2 = float(np.linalg.norm(lab_w - c2_w))
            if d1 <= d2:
                assigned.append(1)
                if d1 < d2 * 0.75 and d1 < 48.0:
                    t1_updates.append(lab)
            else:
                assigned.append(2)
                if d2 < d1 * 0.75 and d2 < 48.0:
                    t2_updates.append(lab)

        alpha = 0.06
        if t1_updates:
            self.team_centroids[1] = (1.0 - alpha) * c1 + alpha * np.mean(
                t1_updates, axis=0
            )
        if t2_updates:
            self.team_centroids[2] = (1.0 - alpha) * c2 + alpha * np.mean(
                t2_updates, axis=0
            )

        return assigned

    def _match_and_track_players(
        self,
        player_dets: list[dict[str, Any]],
        player_labs: list[np.ndarray],
        assigned_teams: list[int],
    ) -> tuple[list[int], list[int]]:
        """Match current player detections to existing tracks for persistent IDs.

        Returns (track_ids, stabilized_teams).
        """
        n_curr = len(player_dets)
        track_ids = [-1] * n_curr
        final_teams = list(assigned_teams)

        active_tids = list(self.tracks.keys())
        matched_det_indices: set[int] = set()
        matched_tids: set[int] = set()

        if active_tids and n_curr > 0:
            cost_matrix = np.full((len(active_tids), n_curr), 1e6, dtype=np.float64)
            for row, tid in enumerate(active_tids):
                tr = self.tracks[tid]
                t_cx, t_cy = tr["cx"], tr["cy"]
                t_size = max(tr["w"], tr["h"])
                t_lab = tr["lab"]
                t_team = tr["team"]

                for col, det in enumerate(player_dets):
                    d_cx = float(det["x"]) + float(det["w"]) / 2.0
                    d_cy = float(det["y"]) + float(det["h"]) / 2.0
                    d_size = max(float(det["w"]), float(det["h"]))

                    spatial_dist = math.hypot(d_cx - t_cx, d_cy - t_cy)
                    max_dist = max(8.0, 2.5 * max(t_size, d_size))
                    # Allow slightly larger distance if track was missed for 1+ frames
                    max_dist *= 1.0 + 0.25 * tr["missed"]
                    if spatial_dist > max_dist:
                        continue

                    lab_dist = float(np.linalg.norm(player_labs[col] - t_lab))
                    det_team = assigned_teams[col]
                    # Prevent opposite-team players from stealing an existing player's track ID
                    if det_team != t_team and lab_dist > 30.0:
                        continue

                    cost = spatial_dist + 0.15 * lab_dist
                    cost_matrix[row, col] = cost

            if HAS_SCIPY:
                row_ind, col_ind = linear_sum_assignment(cost_matrix)
                pairs = list(zip(row_ind.tolist(), col_ind.tolist(), strict=False))
            else:
                pairs = []
                flat_order = np.argsort(cost_matrix, axis=None)
                used_r, used_c = set(), set()
                for flat_idx in flat_order:
                    r = int(flat_idx // n_curr)
                    c = int(flat_idx % n_curr)
                    if r not in used_r and c not in used_c and cost_matrix[r, c] < 1e5:
                        pairs.append((r, c))
                        used_r.add(r)
                        used_c.add(c)

            for r, c in pairs:
                if cost_matrix[r, c] >= 1e5:
                    continue
                tid = active_tids[r]
                det = player_dets[c]
                matched_det_indices.add(c)
                matched_tids.add(tid)
                track_ids[c] = tid

                tr = self.tracks[tid]
                tr["cx"] = float(det["x"]) + float(det["w"]) / 2.0
                tr["cy"] = float(det["y"]) + float(det["h"]) / 2.0
                tr["w"] = float(det["w"])
                tr["h"] = float(det["h"])
                tr["lab"] = 0.75 * tr["lab"] + 0.25 * player_labs[c]
                tr["missed"] = 0
                tr["hits"] += 1

                # Stabilize team assignment via sliding-window majority vote (last 5 frames)
                votes: deque[int] = tr["team_votes"]
                votes.append(assigned_teams[c])
                count_1 = sum(1 for v in votes if v == 1)
                count_2 = len(votes) - count_1
                best_team = 1 if count_1 > count_2 else (2 if count_2 > count_1 else assigned_teams[c])
                tr["team"] = best_team
                final_teams[c] = best_team

        # Increment missed count for unmatched tracks and expire stale ones
        for tid in active_tids:
            if tid not in matched_tids:
                self.tracks[tid]["missed"] += 1
                if self.tracks[tid]["missed"] > self.max_missed_frames:
                    del self.tracks[tid]

        # Create new tracks for unmatched detections
        for idx in range(n_curr):
            if idx not in matched_det_indices:
                tid = self.next_track_id
                self.next_track_id += 1
                det = player_dets[idx]
                team_id = assigned_teams[idx]
                self.tracks[tid] = {
                    "cx": float(det["x"]) + float(det["w"]) / 2.0,
                    "cy": float(det["y"]) + float(det["h"]) / 2.0,
                    "w": float(det["w"]),
                    "h": float(det["h"]),
                    "lab": player_labs[idx].copy(),
                    "team": team_id,
                    "team_votes": deque([team_id], maxlen=5),
                    "missed": 0,
                    "hits": 1,
                }
                track_ids[idx] = tid
                final_teams[idx] = team_id

        return track_ids, final_teams

    def _build_team_info(self, player_counts: dict[int, int]) -> dict[str, dict[str, Any]]:
        """Construct Team 1 and Team 2 metadata dicts with colors and possession %."""
        total_poss_frames = self.possession_frames[1] + self.possession_frames[2]
        teams: dict[str, dict[str, Any]] = {}

        default_bgrs = {1: (235, 99, 37), 2: (38, 38, 220)}  # Blue / Red fallbacks
        for team_id in (1, 2):
            if team_id in self.team_centroids:
                bgr = lab_to_bgr(self.team_centroids[team_id])
            else:
                bgr = default_bgrs[team_id]
            rgb = (bgr[2], bgr[1], bgr[0])
            frames = self.possession_frames[team_id]
            pct = (
                round((frames / total_poss_frames) * 100.0, 1)
                if total_poss_frames > 0
                else 0.0
            )
            teams[str(team_id)] = {
                "id": team_id,
                "label": f"Team {team_id}",
                "color_hex": rgb_to_hex(rgb),
                "color_rgb": [rgb[0], rgb[1], rgb[2]],
                "color_bgr": [bgr[0], bgr[1], bgr[2]],
                "color_name": describe_color_name(bgr)
                if team_id in self.team_centroids
                else f"Team {team_id}",
                "player_count": player_counts.get(team_id, 0),
                "possession_frames": frames,
                "possession_pct": pct,
                "losses": self.team_losses[team_id],
            }
        return teams

    def process_frame(
        self,
        frame_bgr: np.ndarray,
        detections: list[dict[str, Any]],
        timestamp: float = 0.0,
    ) -> dict[str, Any]:
        """Enrich player detections with team assignments and evaluate ball possession."""
        self.last_access = time.time()
        self.frame_index += 1

        player_indices: list[int] = []
        player_dets: list[dict[str, Any]] = []
        player_labs: list[np.ndarray] = []
        player_bgrs: list[tuple[int, int, int]] = []
        player_hexes: list[str] = []
        football_dets: list[dict[str, Any]] = []

        pitch_profile = estimate_pitch_profile(frame_bgr)
        for idx, det in enumerate(detections):
            cls_name = str(det.get("class", "")).lower().strip()
            if cls_name in PLAYER_CLASSES:
                extracted = extract_player_jersey_color(
                    frame_bgr, det, pitch_profile=pitch_profile
                )
                if extracted is None:
                    lab_vec = np.array([128.0, 128.0, 128.0], dtype=np.float32)
                    bgr_tuple = (128, 128, 128)
                    hex_str = "#808080"
                else:
                    lab_vec, bgr_tuple, hex_str = extracted
                player_indices.append(idx)
                player_dets.append(det)
                player_labs.append(lab_vec)
                player_bgrs.append(bgr_tuple)
                player_hexes.append(hex_str)
            elif cls_name in ("football", "ball"):
                football_dets.append(det)

        assigned_teams = self._update_team_centroids(player_labs)
        track_ids, final_teams = self._match_and_track_players(
            player_dets, player_labs, assigned_teams
        )

        player_counts = {1: 0, 2: 0}
        teams_snapshot = self._build_team_info(player_counts)

        # Annotate each player detection in-place
        carrier_candidates: list[dict[str, Any]] = []
        for i, det_idx in enumerate(player_indices):
            det = detections[det_idx]
            team_id = final_teams[i]
            tid = track_ids[i]
            player_counts[team_id] = player_counts.get(team_id, 0) + 1

            team_meta = teams_snapshot[str(team_id)]
            bgr = player_bgrs[i]
            is_carrier = str(det.get("class", "")).lower().strip() == "player with ball"

            det["track_id"] = tid
            det["team"] = team_id
            det["team_label"] = team_meta["label"]
            det["team_color_hex"] = team_meta["color_hex"]
            det["team_color_rgb"] = team_meta["color_rgb"]
            det["team_color_bgr"] = team_meta["color_bgr"]
            det["team_color_name"] = team_meta["color_name"]
            det["jersey_color_hex"] = player_hexes[i]
            det["jersey_color_rgb"] = [bgr[2], bgr[1], bgr[0]]
            det["has_ball"] = is_carrier

            if is_carrier:
                carrier_candidates.append(det)

        # Select primary ball carrier (highest confidence, tie-broken by proximity to football)
        active_carrier: dict[str, Any] | None = None
        if carrier_candidates:
            if len(carrier_candidates) == 1 or not football_dets:
                active_carrier = max(
                    carrier_candidates, key=lambda d: float(d.get("confidence", 0.0))
                )
            else:
                ball = max(football_dets, key=lambda d: float(d.get("confidence", 0.0)))
                bx = float(ball["x"]) + float(ball["w"]) / 2.0
                by = float(ball["y"]) + float(ball["h"]) / 2.0

                def _score(d: dict[str, Any]) -> float:
                    dx = float(d["x"]) + float(d["w"]) / 2.0
                    dy = float(d["y"]) + float(d["h"]) / 2.0
                    dist = math.hypot(dx - bx, dy - by)
                    return float(d.get("confidence", 0.0)) - 0.01 * dist

                active_carrier = max(carrier_candidates, key=_score)

        # Evaluate possession state machine
        prev_id = self.prev_carrier_id
        prev_team = self.prev_carrier_team
        player_changed = False
        team_changed = False
        possession_lost = False
        possession_status = "no_carrier"
        status_label = "No Ball-Carrier Detected"
        latest_event: dict[str, Any] | None = None
        carrier_payload: dict[str, Any] | None = None

        if active_carrier is not None:
            curr_id = int(active_carrier["track_id"])
            curr_team = int(active_carrier["team"])
            curr_team_label = str(active_carrier["team_label"])

            carrier_payload = {
                "track_id": curr_id,
                "detection_id": active_carrier.get("id"),
                "team": curr_team,
                "team_label": curr_team_label,
                "team_color_hex": active_carrier.get("team_color_hex"),
                "team_color_name": active_carrier.get("team_color_name"),
                "confidence": active_carrier.get("confidence"),
                "x": active_carrier.get("x"),
                "y": active_carrier.get("y"),
            }

            self.possession_frames[curr_team] = self.possession_frames.get(curr_team, 0) + 1

            if prev_team is None:
                possession_status = "acquired"
                status_label = f"{curr_team_label} ({active_carrier.get('team_color_name')}) Started Possession (#{curr_id})"
                latest_event = {
                    "id": f"poss-{self.frame_index}-{len(self.events) + 1}",
                    "timestamp": round(timestamp, 2),
                    "type": "acquired",
                    "from_team": None,
                    "to_team": curr_team,
                    "from_team_label": None,
                    "to_team_label": curr_team_label,
                    "from_player_id": None,
                    "to_player_id": curr_id,
                    "possession_lost": False,
                    "status_label": status_label,
                }
                self.events.append(latest_event)
                self.prev_carrier_id = curr_id
                self.prev_carrier_team = curr_team

            elif curr_team != prev_team:
                # Player with ball changed team -> Possession Lost
                player_changed = True
                team_changed = True
                possession_lost = True
                possession_status = "lost"
                status_label = (
                    f"Possession Lost! Team {prev_team} -> {curr_team_label}"
                )
                self.total_possession_losses += 1
                self.team_losses[prev_team] = self.team_losses.get(prev_team, 0) + 1

                latest_event = {
                    "id": f"poss-{self.frame_index}-{len(self.events) + 1}",
                    "timestamp": round(timestamp, 2),
                    "type": "lost",
                    "from_team": prev_team,
                    "to_team": curr_team,
                    "from_team_label": f"Team {prev_team}",
                    "to_team_label": curr_team_label,
                    "from_player_id": prev_id,
                    "to_player_id": curr_id,
                    "possession_lost": True,
                    "status_label": status_label,
                }
                self.events.append(latest_event)
                self.prev_carrier_id = curr_id
                self.prev_carrier_team = curr_team

            elif curr_id != prev_id:
                # Player with ball changed, but team stayed the SAME -> Possession NOT Lost
                player_changed = True
                team_changed = False
                possession_lost = False
                possession_status = "not_lost"
                status_label = (
                    f"Possession Not Lost ({curr_team_label} • Player #{prev_id} -> #{curr_id})"
                )
                self.total_same_team_passes += 1

                latest_event = {
                    "id": f"poss-{self.frame_index}-{len(self.events) + 1}",
                    "timestamp": round(timestamp, 2),
                    "type": "not_lost",
                    "from_team": prev_team,
                    "to_team": curr_team,
                    "from_team_label": f"Team {prev_team}",
                    "to_team_label": curr_team_label,
                    "from_player_id": prev_id,
                    "to_player_id": curr_id,
                    "possession_lost": False,
                    "status_label": status_label,
                }
                self.events.append(latest_event)
                self.prev_carrier_id = curr_id
                self.prev_carrier_team = curr_team

            else:
                # Same player still holds the ball
                possession_status = "holding"
                status_label = f"{curr_team_label} Holding Possession (Player #{curr_id})"
        else:
            if prev_team is not None:
                possession_status = "in_transit"
                status_label = f"Ball In Play (Last: Team {prev_team} • Player #{prev_id})"

        # Rebuild teams info with updated possession counts & player counts
        teams_info = self._build_team_info(player_counts)
        effective_team = (
            carrier_payload["team"] if carrier_payload is not None else self.prev_carrier_team
        )

        return {
            "teams": teams_info,
            "carrier": carrier_payload,
            "current_team": effective_team,
            "current_team_label": f"Team {effective_team}" if effective_team else None,
            "previous_team": prev_team,
            "previous_carrier_id": prev_id,
            "player_changed": player_changed,
            "team_changed": team_changed,
            "possession_lost": possession_lost,
            "possession_status": possession_status,
            "status_label": status_label,
            "total_possession_losses": self.total_possession_losses,
            "total_same_team_passes": self.total_same_team_passes,
            "latest_event": latest_event,
        }

    def get_summary(self) -> dict[str, Any]:
        """Return aggregate team clustering & possession summary across processed frames."""
        teams_info = self._build_team_info({1: 0, 2: 0})
        return {
            "teams": teams_info,
            "current_team": self.prev_carrier_team,
            "current_team_label": (
                f"Team {self.prev_carrier_team}" if self.prev_carrier_team else None
            ),
            "total_possession_losses": self.total_possession_losses,
            "total_same_team_passes": self.total_same_team_passes,
            "possession_events": list(self.events),
            "frames_processed": self.frame_index,
        }


# Thread-safe session store for stateful /api/analyze-frame live tracking
_SESSION_TRACKERS: dict[str, TeamPossessionTracker] = {}
_SESSION_LOCK = threading.Lock()
_MAX_SESSIONS = 50


def get_or_create_session_tracker(
    session_id: str | None,
    reset: bool = False,
) -> TeamPossessionTracker:
    """Return a stateful tracker for `session_id`, or a fresh tracker if omitted."""
    if not session_id:
        return TeamPossessionTracker()

    with _SESSION_LOCK:
        if reset or session_id not in _SESSION_TRACKERS:
            if len(_SESSION_TRACKERS) >= _MAX_SESSIONS and session_id not in _SESSION_TRACKERS:
                oldest_key = min(
                    _SESSION_TRACKERS.keys(),
                    key=lambda k: _SESSION_TRACKERS[k].last_access,
                )
                del _SESSION_TRACKERS[oldest_key]
            _SESSION_TRACKERS[session_id] = TeamPossessionTracker()
        tracker = _SESSION_TRACKERS[session_id]
        tracker.last_access = time.time()
        return tracker

