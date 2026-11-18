"""Session-level pass detection (no team classification).

A pass is counted when ball possession moves from one tracked player to a
*different* tracked player within a short time window and the ball travels a
meaningful distance in between. Nothing here looks at jersey colour or teams.

The detector is fed by the 5-second chunked annotation worker
(``video_annotator.run_chunked_annotation_worker``) using the detections it
already computes. One :class:`PassDetector` is shared by every chunk, so a pass
that starts at the end of chunk *k* and is received at the start of chunk *k+1*
is one possession change, counted exactly once — in the chunk where it is
received.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.optimize import linear_sum_assignment

PLAYER_CLASSES = {"player", "player with ball"}
CARRIER_CLASS = "player with ball"
BALL_CLASS = "football"


class _PlayerTracker:
    """Minimal centroid tracker (Hungarian assignment on pixel distance)."""

    def __init__(self, max_age_frames: int = 10):
        self.max_age_frames = max_age_frames
        self.tracks: dict[int, dict[str, float]] = {}
        self.next_id = 1
        self.frame_index = 0

    def update(self, boxes: list[tuple[float, float, float, float]]) -> list[int]:
        """``boxes`` are pixel (cx, cy, w, h). Returns one track id per box."""
        self.frame_index += 1
        ids = list(self.tracks)
        assigned: list[int | None] = [None] * len(boxes)
        if ids and boxes:
            big = 1e9
            cost = np.full((len(ids), len(boxes)), big)
            for ti, tid in enumerate(ids):
                tr = self.tracks[tid]
                age = self.frame_index - tr["last"]
                for di, (cx, cy, w, h) in enumerate(boxes):
                    gate = max(h, tr["h"]) * (0.8 + 0.2 * age)
                    dist = math.hypot(cx - tr["cx"], cy - tr["cy"])
                    if dist <= gate:
                        cost[ti, di] = dist
            rows, cols = linear_sum_assignment(cost)
            for r, c in zip(rows, cols, strict=False):
                if cost[r, c] < big:
                    assigned[c] = ids[r]

        out: list[int] = []
        for di, tid in enumerate(assigned):
            cx, cy, _w, h = boxes[di]
            if tid is None:
                tid = self.next_id
                self.next_id += 1
            self.tracks[tid] = {"cx": cx, "cy": cy, "h": h, "last": self.frame_index}
            out.append(tid)

        for tid in [
            t
            for t, tr in self.tracks.items()
            if self.frame_index - tr["last"] > self.max_age_frames
        ]:
            del self.tracks[tid]
        return out


class PassDetector:
    """Counts passes from per-frame detections (percentage boxes, as returned by
    ``parse_detections``)."""

    def __init__(
        self,
        sample_fps: float = 10.0,
        min_hold_sec: float = 0.2,
        max_pass_gap_sec: float = 3.0,
        min_pass_distance_ratio: float = 0.04,
        ball_reach_ratio: float = 0.9,
    ):
        # Confirm a new owner only after it holds the ball this long (debounce).
        self.min_hold_samples = max(1, round(min_hold_sec * sample_fps))
        # Ownership changes separated by more than this are not passes (loose ball).
        self.max_pass_gap_sec = max_pass_gap_sec
        # Ball must travel >= this fraction of the frame diagonal (filters ID swaps).
        self.min_pass_distance_ratio = min_pass_distance_ratio
        # Ball counts as "at the feet" within this many player-heights.
        self.ball_reach_ratio = ball_reach_ratio
        self.tracker = _PlayerTracker(max_age_frames=max(3, round(sample_fps)))

        self.owner: int | None = None
        self.owner_last_pos: tuple[float, float] | None = None
        self.owner_last_time: float | None = None
        self._candidate: int | None = None
        self._candidate_count = 0
        self._candidate_first_time = 0.0
        self._candidate_first_pos: tuple[float, float] | None = None
        self.passes: list[dict[str, Any]] = []
        # Latest frame state, used to draw the in-flight pass line.
        self.ball_pos: tuple[float, float] | None = None
        self._holder_is_owner = False
        self._last_time = 0.0

    def _find_holder(
        self, players: list[dict[str, Any]], ball: dict[str, Any] | None
    ) -> dict[str, Any] | None:
        if ball is not None:
            bx, by = ball["cx"], ball["cy"]

            def dist(p):
                return math.hypot(p["cx"] - bx, p["feet_y"] - by)

            nearest = min(players, key=dist, default=None)
            if nearest is not None and dist(nearest) <= self.ball_reach_ratio * max(
                nearest["h"], 1.0
            ):
                return nearest
            carriers = [p for p in players if p["cls"] == CARRIER_CLASS]
            if carriers:
                c = min(carriers, key=dist)
                if dist(c) <= 1.5 * self.ball_reach_ratio * max(c["h"], 1.0):
                    return c
            return None
        carriers = [p for p in players if p["cls"] == CARRIER_CLASS]
        if carriers:
            return max(carriers, key=lambda p: p["conf"])
        return None

    def process(
        self,
        detections: list[dict[str, Any]],
        timestamp: float,
        frame_w: int,
        frame_h: int,
    ) -> dict[str, Any] | None:
        """Feeds one sampled frame. Returns the pass event if one completed."""
        players: list[dict[str, Any]] = []
        best_ball: dict[str, Any] | None = None
        for d in detections:
            cls = str(d.get("class", "")).lower().strip()
            x = float(d.get("x", 0.0)) * frame_w / 100.0
            y = float(d.get("y", 0.0)) * frame_h / 100.0
            w = float(d.get("w", 0.0)) * frame_w / 100.0
            h = float(d.get("h", 0.0)) * frame_h / 100.0
            conf = float(d.get("confidence", 0.0))
            if cls in PLAYER_CLASSES:
                players.append(
                    {
                        "cls": cls,
                        "cx": x + w / 2,
                        "cy": y + h / 2,
                        "feet_y": y + h,
                        "w": w,
                        "h": h,
                        "conf": conf,
                    }
                )
            elif cls == BALL_CLASS and (best_ball is None or conf > best_ball["conf"]):
                best_ball = {"cx": x + w / 2, "cy": y + h / 2, "conf": conf}

        self._last_time = timestamp
        self.ball_pos = (best_ball["cx"], best_ball["cy"]) if best_ball else None
        self._holder_is_owner = False

        ids = self.tracker.update([(p["cx"], p["cy"], p["w"], p["h"]) for p in players])
        for p, tid in zip(players, ids, strict=False):
            p["track_id"] = tid

        holder = self._find_holder(players, best_ball) if players else None
        if holder is None:
            self._candidate, self._candidate_count = None, 0
            return None

        tid = holder["track_id"]
        pos = (holder["cx"], holder["feet_y"])

        if tid == self.owner:
            self._holder_is_owner = True
            self.owner_last_pos, self.owner_last_time = pos, timestamp
            self._candidate, self._candidate_count = None, 0
            return None

        if tid != self._candidate:
            self._candidate = tid
            self._candidate_count = 0
            self._candidate_first_time = timestamp
            self._candidate_first_pos = pos
        self._candidate_count += 1
        if self._candidate_count < self.min_hold_samples:
            return None

        # Candidate confirmed as the new owner.
        event = None
        if self.owner is not None and self.owner_last_pos is not None:
            gap = self._candidate_first_time - (self.owner_last_time or 0.0)
            travel = math.hypot(
                self._candidate_first_pos[0] - self.owner_last_pos[0],
                self._candidate_first_pos[1] - self.owner_last_pos[1],
            )
            min_travel = self.min_pass_distance_ratio * math.hypot(frame_w, frame_h)
            if 0.0 <= gap <= self.max_pass_gap_sec and travel >= min_travel:
                event = {
                    "from_player": self.owner,
                    "to_player": tid,
                    "start_time": round(self.owner_last_time or 0.0, 2),
                    "end_time": round(self._candidate_first_time, 2),
                    # Pixel positions (feet) of passer and receiver, for 2D lines.
                    "from_pos": [round(v, 1) for v in self.owner_last_pos],
                    "to_pos": [round(v, 1) for v in self._candidate_first_pos],
                }
                self.passes.append(event)

        self.owner = tid
        self._holder_is_owner = True
        self.owner_last_pos, self.owner_last_time = pos, timestamp
        self._candidate, self._candidate_count = None, 0
        return event

    def in_flight_line(
        self,
    ) -> tuple[tuple[float, float], tuple[float, float]] | None:
        """(passer_pos, ball_pos) while the ball has left its owner and could still
        become a pass; ``None`` otherwise."""
        if (
            self.owner is None
            or self.owner_last_pos is None
            or self.ball_pos is None
            or self._holder_is_owner
            or self._last_time - (self.owner_last_time or 0.0) > self.max_pass_gap_sec
        ):
            return None
        return self.owner_last_pos, self.ball_pos
