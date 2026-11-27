"""Goal detection, from marked goal landmarks or (fallback) detected goal boxes.

Two modes, chosen automatically:

* **Landmarks** (``mode == "landmarks"``) - the user marked each goal mouth once (see
  ``goal_landmarks.py``). These fixed polygons are used and the model's
  ``football goal`` boxes are ignored. Needs a static camera; adds the goal-ROI
  motion rescue (``GoalRoiMotionTracker``) for balls YOLO drops in the net.
* **Auto** (``mode == "auto"``) - nothing is marked, so every ``football goal``
  detection with ``confidence >= min_goal_confidence`` becomes a goal mouth
  (``GoalMouth.from_detection_box``: posts in 6%, crossbar down 8%, bottom flush with
  the goal line). Goal boxes are tracked across frames by IoU (``>= auto_match_iou``)
  so a pending goal follows the goal through camera pans and zooms; if the goal box
  is missed for a frame, the last known mouth is kept. The static-camera motion
  rescue only runs for a goal box that has stayed put (IoU ``>= stationary_iou``
  for ``stationary_frames`` frames). Goal boxes taller than
  ``max_auto_goal_box_height`` % of the frame (close-up / replay angles) are ignored. A ``player with ball`` box holding the ball in
  the mouth also cancels a candidate as a save.

Everything below applies to both modes; "goal mouth" means the marked polygon or the
one built from the detected box.

A goal is confirmed for a goal mouth when all of these hold:

1. **Entry through the mouth** - within ``entry_window_sec`` before the ball was first
   seen in the goal it was seen outside it, so a ball resting in the goal from the
   start does not count. If that last outside sighting was between the posts but above
   the crossbar line, the ball went *over the bar* and dropped behind the goal, so it
   does not count either.
2. **In the mouth** - the ball centre is inside the marked goal quadrilateral (shrunk a
   little so posts and crossbar edges do not count). While a goal is pending, a ball
   drawn above the crossbar line (in the roof of the net) is ignored, not cancelled.
3. **Behind the goal line, not in front of the goal** - on screen, a ball in front of
   the goal overlaps the goal mouth just like a ball in the net. Two checks tell them
   apart:

   * *Goal-line side*: the ball's ground point (bottom of its box) must be on the net
     side of the line between the two post feet. With an elevated camera, ground
     points behind the goal line are drawn on the crossbar side of that line and
     ground points in front of the goal on the other side.
   * *Apparent size*: a ball much closer to the camera than the goal looks bigger. A
     ball box taller than ``max_ball_size_factor`` x the size a ball would have at the
     goal (ball 0.22 m vs post 2.44 m) is in front of the goal.

4. **Stays in** - the ball stays valid-inside for ``min_inside_samples`` samples over at
   least ``min_inside_sec``, or is seen inside at least twice and then disappears for
   ``hidden_confirm_sec`` (hidden by the net / keeper). A ball crossing in front of the
   mouth passes through in a fraction of a second; a ball in the net stays there.
5. **Not held in front of the goal** - a player whose feet are in front of the goal line
   and whose box contains the ball (the keeper catching or holding it) cancels the
   candidate as a save. A keeper lying in the net behind the line does not.

After a goal there is a ``cooldown_sec`` pause so the ball sitting in the net does not
count twice. The scorer is the last carrier before the ball entered the goal.
"""

from __future__ import annotations

import math
from collections import deque
from typing import Any

import cv2
import numpy as np

from app.services.goal_landmarks import GoalMouth

BALL_CLASS = "football"
GOAL_CLASS = "football goal"
CARRIER_CLASS = "player with ball"
PLAYER_LIKE_CLASSES = ("player", "player with ball", "referee", "assistant_referee")
TEAM_IDS = (1, 2)


def _cls(det: dict[str, Any]) -> str:
    return str(det.get("class", "")).lower().strip()


def _box_iou(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    """IoU of two ``(x, y, w, h)`` boxes."""
    ax2, ay2 = a[0] + a[2], a[1] + a[3]
    bx2, by2 = b[0] + b[2], b[1] + b[3]
    iw = max(0.0, min(ax2, bx2) - max(a[0], b[0]))
    ih = max(0.0, min(ay2, by2) - max(a[1], b[1]))
    inter = iw * ih
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def _ball_points(
    det: dict[str, Any],
) -> tuple[tuple[float, float], tuple[float, float], float]:
    """(centre, ground point, height) of a ball box, in percent coordinates."""
    x, y = float(det.get("x", 0.0)), float(det.get("y", 0.0))
    w, h = float(det.get("w", 0.0)), float(det.get("h", 0.0))
    return (x + w / 2.0, y + h / 2.0), (x + w / 2.0, y + h), h


class GoalRoiMotionTracker:
    """Static-camera background-diff ball rescue inside each marked goal ROI.

    YOLO often drops a small, motion-blurred ball once it enters a goal backed
    by a dark net or iron fence. Because manual goal landmarks already assume a
    static camera, an EMA background model + frame difference inside the padded
    goal+net ROI (with player boxes masked out) cleanly tracks ball-sized blobs
    through the mouth and into the back of the net at < 0.5 ms per frame.
    """

    def __init__(self, bg_alpha: float = 0.03):
        self.bg_alpha = bg_alpha
        self.reset()

    def reset(self) -> None:
        self._bg: dict[str, np.ndarray] = {}
        self._prev: dict[str, np.ndarray] = {}
        self._roi: dict[str, tuple[int, int, int, int]] = {}
        self._last_blob: dict[str, tuple[float, tuple[float, float]]] = {}
        self._frame_count: dict[str, int] = {}

    def _roi_px(
        self, mouth: GoalMouth, width: int, height: int
    ) -> tuple[int, int, int, int]:
        x1p, y1p, x2p, y2p = mouth.roi_bbox()
        rx1 = max(0, int(x1p / 100.0 * width))
        ry1 = max(0, int(y1p / 100.0 * height))
        rx2 = min(width, max(rx1 + 4, math.ceil(x2p / 100.0 * width)))
        ry2 = min(height, max(ry1 + 4, math.ceil(y2p / 100.0 * height)))
        return rx1, ry1, rx2, ry2

    def update_and_find(
        self,
        frame_bgr: np.ndarray | None,
        mouths: list[GoalMouth],
        detections: list[dict[str, Any]],
        t: float,
        anchor_pos: tuple[float, float] | None = None,
        anchor_t: float | None = None,
        search_active: bool = False,
    ) -> list[dict[str, Any]]:
        """Update static background models and optionally return rescued ball dicts."""
        if frame_bgr is None or frame_bgr.size == 0 or not mouths:
            return []
        h, w = frame_bgr.shape[:2]
        if h < 16 or w < 16:
            return []

        rescued: list[dict[str, Any]] = []
        player_boxes_px: list[tuple[int, int, int, int]] = []
        for d in detections:
            if _cls(d) not in PLAYER_LIKE_CLASSES:
                continue
            px1 = int(float(d.get("x", 0.0)) / 100.0 * w)
            py1 = int(float(d.get("y", 0.0)) / 100.0 * h)
            pw = int(float(d.get("w", 0.0)) / 100.0 * w)
            ph = int(float(d.get("h", 0.0)) / 100.0 * h)
            pad_x = max(2, int(0.10 * pw))
            pad_y = max(2, int(0.06 * ph))
            player_boxes_px.append(
                (
                    max(0, px1 - pad_x),
                    max(0, py1 - pad_y),
                    min(w, px1 + pw + pad_x),
                    min(h, py1 + ph + pad_y),
                )
            )

        for mouth in mouths:
            mid = mouth.id
            roi = self._roi_px(mouth, w, h)
            rx1, ry1, rx2, ry2 = roi
            crop = frame_bgr[ry1:ry2, rx1:rx2]
            if crop.size == 0:
                continue
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)

            if mid not in self._bg or self._roi.get(mid) != roi:
                self._bg[mid] = gray.copy()
                self._prev[mid] = gray.copy()
                self._roi[mid] = roi
                self._frame_count[mid] = 1
                continue

            self._frame_count[mid] += 1
            bg = self._bg[mid]
            prev = self._prev[mid]

            # Build player exclusion mask in ROI coordinates.
            non_player = np.ones(gray.shape, dtype=bool)
            for px1, py1, px2, py2 in player_boxes_px:
                ix1, iy1 = max(0, px1 - rx1), max(0, py1 - ry1)
                ix2, iy2 = min(rx2 - rx1, px2 - rx1), min(ry2 - ry1, py2 - ry1)
                if ix2 > ix1 and iy2 > iy1:
                    non_player[iy1:iy2, ix1:ix2] = False

            if search_active and self._frame_count[mid] >= 3:
                diff_bg = np.abs(gray - bg)
                diff_mot = np.abs(gray - prev)
                mask = ((diff_bg > 22.0) & (diff_mot > 15.0) & non_player).astype(
                    np.uint8
                ) * 255
                if np.any(mask):
                    mask = cv2.morphologyEx(
                        mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)
                    )
                    mask = cv2.morphologyEx(
                        mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)
                    )
                    num, _labels, stats, centroids = cv2.connectedComponentsWithStats(
                        mask
                    )
                    exp_px = max(6.0, mouth.expected_ball_height() / 100.0 * h)
                    min_dim = max(5.0, 0.45 * exp_px)
                    max_dim = max(14.0, 2.8 * exp_px)

                    best_cand = None
                    last_blob = self._last_blob.get(mid)
                    ref_pos = (
                        last_blob[1]
                        if last_blob is not None and 0.0 < t - last_blob[0] <= 0.5
                        else anchor_pos
                    )
                    ref_t = (
                        last_blob[0]
                        if last_blob is not None and 0.0 < t - last_blob[0] <= 0.5
                        else anchor_t
                    )

                    for i in range(1, num):
                        _bx, by, bw, bh, area = stats[i]
                        if not (min_dim <= bw <= max_dim and min_dim <= bh <= max_dim):
                            continue
                        aspect = bw / max(1.0, float(bh))
                        if not (0.45 <= aspect <= 2.2):
                            continue
                        if area / max(1.0, float(bw * bh)) < 0.30:
                            continue

                        cx_pct = (rx1 + float(centroids[i][0])) / w * 100.0
                        cy_pct = (ry1 + float(centroids[i][1])) / h * 100.0
                        w_pct = float(bw) / w * 100.0
                        h_pct = float(bh) / h * 100.0
                        gnd_pct = (cx_pct, (ry1 + float(by + bh)) / h * 100.0)

                        # Only rescue blobs inside the mouth or its angled net zone.
                        if not mouth.in_net_zone((cx_pct, cy_pct), gnd_pct):
                            continue

                        dist = 0.0
                        if ref_pos is not None and ref_t is not None:
                            dt_ref = max(0.03, t - ref_t)
                            dist = math.hypot(cx_pct - ref_pos[0], cy_pct - ref_pos[1])
                            # Velocity gate: reject unrelated distant motion.
                            if dt_ref <= 1.5 and dist > 95.0 * dt_ref + 10.0:
                                continue

                        # Prefer blobs closest to the expected ball size and reference.
                        size_err = abs(bh - exp_px) / max(exp_px, 1.0)
                        score = dist + 4.0 * size_err
                        if best_cand is None or score < best_cand[0]:
                            best_cand = (
                                score,
                                {
                                    "class": BALL_CLASS,
                                    "confidence": 0.35,
                                    "x": cx_pct - w_pct / 2.0,
                                    "y": cy_pct - h_pct / 2.0,
                                    "w": w_pct,
                                    "h": h_pct,
                                    "source": "goal_roi_motion",
                                },
                                (cx_pct, cy_pct),
                            )

                    if best_cand is not None:
                        rescued.append(best_cand[1])
                        self._last_blob[mid] = (t, best_cand[2])

            # Update background EMA outside player boxes (and pause during fast
            # motion inside the net so the ball isn't absorbed into background).
            bg_mask = non_player & (np.abs(gray - prev) < 12.0)
            if np.any(bg_mask):
                bg[bg_mask] = (1.0 - self.bg_alpha) * bg[
                    bg_mask
                ] + self.bg_alpha * gray[bg_mask]
            self._prev[mid] = gray

        return rescued


class GoalDetector:
    """Stateful per-clip goal detector (percent coordinates).

    Uses the marked goal mouths when there are any, else the model's
    ``football goal`` boxes (see the module docstring for both modes).
    """

    def __init__(
        self,
        goal_mouths: list[GoalMouth] | None = None,
        min_inside_samples: int = 3,
        min_inside_sec: float = 0.4,
        hidden_confirm_sec: float = 0.8,
        entry_window_sec: float = 4.0,
        cooldown_sec: float = 10.0,
        carrier_memory_sec: float = 8.0,
        control_samples: int = 2,
        max_control_speed: float = 20.0,
        require_behind_goal_line: bool = True,
        goal_line_tolerance: float = 0.0,
        max_ball_size_factor: float = 2.0,
        mouth_shrink: float = 0.05,
        min_ball_confidence: float = 0.15,
        cancel_outside_samples: int = 2,
        default_dt: float = 0.1,
        auto_mode: bool = True,
        min_goal_confidence: float = 0.30,
        auto_match_iou: float = 0.3,
        stationary_iou: float = 0.92,
        stationary_frames: int = 5,
        auto_track_ttl_sec: float = 2.0,
        max_auto_goal_box_height: float = 70.0,
    ):
        self.goal_mouths: list[GoalMouth] = list(goal_mouths or [])
        # Automatic fallback from YOLO "football goal" boxes when nothing is marked.
        self.auto_mode = auto_mode
        self.min_goal_confidence = min_goal_confidence
        self.auto_match_iou = auto_match_iou
        self.stationary_iou = stationary_iou
        self.stationary_frames = stationary_frames
        self.auto_track_ttl_sec = auto_track_ttl_sec
        # A goal box taller than this (percent of the frame) is a close-up/replay
        # camera angle: the goal-line and in-mouth checks lose meaning, and replays
        # would count a goal twice.
        self.max_auto_goal_box_height = max_auto_goal_box_height
        self.min_inside_samples = min_inside_samples
        self.min_inside_sec = min_inside_sec
        self.hidden_confirm_sec = hidden_confirm_sec
        self.entry_window_sec = entry_window_sec
        self.cooldown_sec = cooldown_sec
        self.carrier_memory_sec = carrier_memory_sec
        # Scorer = last player in control: same player for N samples, ball at
        # dribbling speed (percent of the frame per second), not a shot flying past.
        self.control_samples = control_samples
        self.max_control_speed = max_control_speed
        self.require_behind_goal_line = require_behind_goal_line
        self.goal_line_tolerance = goal_line_tolerance
        self.max_ball_size_factor = max_ball_size_factor
        self.mouth_shrink = mouth_shrink
        self.min_ball_confidence = min_ball_confidence
        self.cancel_outside_samples = cancel_outside_samples
        self.default_dt = default_dt
        self.roi_tracker = GoalRoiMotionTracker()
        self.reset()

    @property
    def mode(self) -> str:
        """``"landmarks"`` (marked goals), ``"auto"`` (detected goal boxes) or ``"off"``."""
        if self.goal_mouths:
            return "landmarks"
        return "auto" if self.auto_mode else "off"

    @property
    def enabled(self) -> bool:
        return self.mode != "off"

    def set_goal_mouths(self, goal_mouths: list[GoalMouth] | None) -> None:
        self.goal_mouths = list(goal_mouths or [])
        self.candidate = None
        self.roi_tracker.reset()
        self._auto_tracks = []
        self._active_mouths = list(self.goal_mouths)

    def roi_step_useful(self) -> bool:
        """Whether a ROI-only motion step (frames between YOLO strides) can help.

        Always with landmarks; in auto mode only for a goal box that has stayed put
        (the motion model assumes a static camera).
        """
        if self.mode == "landmarks":
            return True
        return self.mode == "auto" and bool(self._stationary_auto_mouths())

    def display_mouths(self) -> list[GoalMouth]:
        """Goal mouths in use right now (marked, or built from detected boxes)."""
        return list(self._active_mouths)

    def reset(self) -> None:
        self.samples = 0
        self.last_t: float | None = None
        # Recent ball sightings: (t, centre, ground point, height) for the entry check.
        self.ball_history: deque[tuple[float, tuple, tuple, float]] = deque(maxlen=120)
        self.candidate: dict[str, Any] | None = None
        self.last_goal_t = -math.inf
        self.last_carrier: dict[str, Any] | None = None
        self._control: dict[str, Any] | None = None
        self.goals: list[dict[str, Any]] = []
        self.score = dict.fromkeys(TEAM_IDS, 0)
        self.unattributed = 0
        self.saves = 0
        self.over_bar = 0
        self.in_front_rejections = 0
        self._last_counted: dict[str, float] = {}
        self.roi_tracker.reset()
        # Auto mode: tracked "football goal" boxes and the mouths in use this sample.
        self._auto_tracks: list[dict[str, Any]] = []
        self._auto_counter = 0
        self._active_mouths: list[GoalMouth] = list(self.goal_mouths)

    # ------------------------------------------------------------------
    # Geometry helpers
    # ------------------------------------------------------------------

    def _in_front_reason(
        self, mouth: GoalMouth, ground: tuple[float, float], height: float
    ) -> str | None:
        """Why a ball inside the mouth on screen is really in front of the goal."""
        if self.require_behind_goal_line and not mouth.behind_goal_line(
            ground, self.goal_line_tolerance
        ):
            return "in_front_of_goal_line"
        expected = mouth.expected_ball_height()
        if expected > 0 and height > expected * self.max_ball_size_factor:
            return "ball_too_close_to_camera"
        return None

    def _shrink(self, mouth: GoalMouth) -> float:
        """Auto mouths already have their post/crossbar margins built in."""
        return 0.0 if mouth.is_auto else self.mouth_shrink

    def _valid_inside(self, mouth: GoalMouth, centre, ground, height) -> bool:
        return mouth.contains(centre, self._shrink(mouth)) and (
            self._in_front_reason(mouth, ground, height) is None
        )

    def _entry(self, mouth: GoalMouth, t_first_inside: float) -> str | None:
        """How the ball got into the mouth, from its last sighting outside it.

        Returns ``"mouth"`` (came from the field side: a valid entry), ``"over_bar"``
        (last seen above the crossbar line: it dropped in behind the goal after going
        over the bar) or ``None`` (never seen outside recently: it was already there).
        """
        for t, centre, ground, height in reversed(self.ball_history):
            if t >= t_first_inside:
                continue
            if t_first_inside - t > self.entry_window_sec:
                break
            if self._valid_inside(mouth, centre, ground, height):
                continue
            return "over_bar" if mouth.over_crossbar(centre) else "mouth"
        return None

    def _count_once(self, counter: str, t: float) -> None:
        """Count a rejection once per episode, not once per frame."""
        last = self._last_counted.get(counter, -math.inf)
        if t - last > 1.0:
            setattr(self, counter, getattr(self, counter) + 1)
        self._last_counted[counter] = t

    @staticmethod
    def _held_in_front(
        detections: list[dict[str, Any]], mouth: GoalMouth, centre: tuple[float, float]
    ) -> bool:
        """The ball is held: a save, not a goal.

        A player standing in front of the goal line has the ball in their box. For
        auto mouths (whose goal line is only the detected box's bottom edge) a
        ``player with ball`` box holding the ball counts wherever the feet are.
        """
        for d in detections:
            if _cls(d) not in PLAYER_LIKE_CLASSES:
                continue
            x, y = float(d.get("x", 0.0)), float(d.get("y", 0.0))
            w, h = float(d.get("w", 0.0)), float(d.get("h", 0.0))
            if not (x <= centre[0] <= x + w and y <= centre[1] <= y + h):
                continue
            if mouth.is_auto and _cls(d) == CARRIER_CLASS:
                return True
            feet = (x + w / 2.0, y + h)
            if not mouth.behind_goal_line(feet, 0.0):
                return True
        return False

    # ------------------------------------------------------------------
    # Auto mode: goal mouths from tracked "football goal" boxes
    # ------------------------------------------------------------------

    def _stationary_auto_mouths(self) -> list[GoalMouth]:
        """Frozen mouths of goal boxes that stayed put (static camera)."""
        return [
            tr["roi_mouth"]
            for tr in self._auto_tracks
            if tr.get("roi_mouth") is not None
            and tr["stationary"] >= self.stationary_frames
        ]

    def _update_auto_mouths(self, detections: list[dict[str, Any]], t: float) -> None:
        """Match this sample's goal boxes to tracked goals and build their mouths."""
        boxes = sorted(
            (
                (
                    float(d.get("x", 0.0)),
                    float(d.get("y", 0.0)),
                    float(d.get("w", 0.0)),
                    float(d.get("h", 0.0)),
                    float(d.get("confidence", 0.0)),
                )
                for d in detections
                if _cls(d) == GOAL_CLASS
                and float(d.get("confidence", 0.0)) >= self.min_goal_confidence
                and float(d.get("w", 0.0)) > 0
                and 0 < float(d.get("h", 0.0)) <= self.max_auto_goal_box_height
            ),
            key=lambda b: -b[4],
        )
        seen: list[dict[str, Any]] = []
        for box in boxes:
            xywh = box[:4]
            best, best_iou = None, self.auto_match_iou
            for tr in self._auto_tracks:
                if tr in seen:
                    continue
                iou = _box_iou(tr["box"], xywh)
                if iou >= best_iou:
                    best, best_iou = tr, iou
            if best is None:
                self._auto_counter += 1
                best = {
                    "id": f"auto_goal_{self._auto_counter}",
                    "box": xywh,
                    "stationary": 0,
                    "roi_mouth": None,
                }
                self._auto_tracks.append(best)
            else:
                still = best_iou >= self.stationary_iou
                best["stationary"] = best["stationary"] + 1 if still else 0
                best["box"] = xywh
            try:
                side = "left" if xywh[0] + xywh[2] / 2.0 < 50.0 else "right"
                best["mouth"] = GoalMouth.from_detection_box(
                    best["id"], xywh, label=f"Goal (auto, {side} of screen)"
                )
            except ValueError:
                continue  # degenerate box (tiny / far away)
            if best["stationary"] < self.stationary_frames:
                best["roi_mouth"] = None
            elif best.get("roi_mouth") is None:
                best["roi_mouth"] = best["mouth"]  # freeze so the ROI stays fixed
            best["last_t"] = t
            seen.append(best)

        self._auto_tracks = [
            tr
            for tr in self._auto_tracks
            if t - tr.get("last_t", t) <= self.auto_track_ttl_sec
        ]
        self._active_mouths = [tr["mouth"] for tr in seen if "mouth" in tr]
        self._follow_candidate(seen)

    def _follow_candidate(self, seen: list[dict[str, Any]]) -> None:
        """Keep a pending goal on its (moving) goal, or on its last known mouth."""
        cand = self.candidate
        if cand is None or not cand["mouth"].is_auto:
            return
        for tr in seen:
            if tr["id"] == cand["mouth"].id and "mouth" in tr:
                cand["mouth"] = tr["mouth"]
                return
        self._active_mouths.append(cand["mouth"])  # goal box missed this sample

    def _roi_mouths(self) -> list[GoalMouth]:
        if self.mode == "landmarks":
            return self.goal_mouths
        return self._stationary_auto_mouths()

    def _ball_speed(self, sighting, t: float) -> float | None:
        """Ball speed in percent of the frame per second, from the previous sighting."""
        if sighting is None or not self.ball_history:
            return None
        pt, prev_centre = self.ball_history[-1][0], self.ball_history[-1][1]
        dt = t - pt
        if dt <= 0 or dt > 0.5:
            return None
        dx, dy = sighting[0][0] - prev_centre[0], sighting[0][1] - prev_centre[1]
        return math.hypot(dx, dy) / dt

    def _remember_carrier(
        self, carrier: dict[str, Any] | None, t: float, ball_speed: float | None
    ) -> None:
        """Remember the scorer candidate: a player in *control* of the ball.

        The model has no carrier class, so "carrier" is the player nearest the ball. A
        shot flying past a defender's feet would make that defender the carrier for a
        sample or two. Only count control when the ball is moving at dribbling speed and
        stays with the same player for ``control_samples`` samples in a row.
        """
        if not carrier or carrier.get("team_id") not in TEAM_IDS:
            self._control = None
            return
        if ball_speed is not None and ball_speed > self.max_control_speed:
            self._control = None
            return
        key = (carrier.get("track_id"), carrier.get("team_id"))
        if self._control and self._control["key"] == key:
            self._control["count"] += 1
        else:
            self._control = {"key": key, "count": 1}
        if self._control["count"] >= self.control_samples:
            self.last_carrier = {"track_id": key[0], "team_id": key[1], "t": t}

    def _time(self, timestamp: float | None) -> float:
        if timestamp is not None:
            return float(timestamp)
        return 0.0 if self.last_t is None else self.last_t + self.default_dt

    # ------------------------------------------------------------------
    # Per-sample update
    # ------------------------------------------------------------------

    def _has_recent_outside(self, t: float) -> bool:
        for pt, centre, ground, height in reversed(self.ball_history):
            if t - pt > self.entry_window_sec:
                break
            if not any(
                self._valid_inside(m, centre, ground, height)
                for m in self._active_mouths
            ):
                return True
        return False

    @staticmethod
    def _is_player_foot_fp(
        det: dict[str, Any], detections: list[dict[str, Any]], mouth: GoalMouth
    ) -> bool:
        """True if a ball box sits on a player's lower body/shoes outside the goal."""
        if det.get("source") == "goal_roi_motion":
            return False
        centre, ground, _ = _ball_points(det)
        if mouth.in_net_zone(centre, ground):
            return False
        for d in detections:
            if _cls(d) not in PLAYER_LIKE_CLASSES:
                continue
            x, y = float(d.get("x", 0.0)), float(d.get("y", 0.0))
            w, h = float(d.get("w", 0.0)), float(d.get("h", 0.0))
            if h <= 0 or w <= 0:
                continue
            # Lower 35% of the player box (shins / shoes), with small horizontal pad.
            if (
                x - 0.15 * w <= centre[0] <= x + 1.15 * w
                and y + 0.65 * h <= centre[1] <= y + 1.08 * h
            ):
                return True
        return False

    def _select_ball(
        self,
        detections: list[dict[str, Any]],
        t: float,
        frame_bgr: np.ndarray | None,
    ) -> dict[str, Any] | None:
        yolo_balls = [
            d
            for d in detections
            if _cls(d) == BALL_CLASS
            and float(d.get("confidence", 1.0)) >= self.min_ball_confidence
        ]

        has_yolo_in_goal = any(
            m.in_net_zone(*_ball_points(b)[:2])
            for b in yolo_balls
            for m in self._active_mouths
        )

        cand = self.candidate
        if cand is not None:
            anchor_pos = cand.get("last_pos")
            anchor_t = cand.get("last_inside_t")
            search_active = not has_yolo_in_goal
        else:
            anchor_pos = self.ball_history[-1][1] if self.ball_history else None
            anchor_t = self.ball_history[-1][0] if self.ball_history else None
            search_active = (not has_yolo_in_goal) and self._has_recent_outside(t)

        motion_balls = self.roi_tracker.update_and_find(
            frame_bgr,
            self._roi_mouths(),
            detections,
            t,
            anchor_pos=anchor_pos,
            anchor_t=anchor_t,
            search_active=search_active,
        )

        # When a goal candidate is active, prioritise detections inside that goal
        # or its net zone, and gate out shoe false positives / teleports on the pitch.
        if cand is not None:
            mouth: GoalMouth = cand["mouth"]
            for pool in (yolo_balls, motion_balls):
                in_goal = [
                    b
                    for b in pool
                    if mouth.contains(_ball_points(b)[0], self._shrink(mouth))
                    or mouth.in_net_zone(*_ball_points(b)[:2])
                    or mouth.over_crossbar(_ball_points(b)[0])
                ]
                if in_goal:
                    return max(in_goal, key=lambda d: float(d.get("confidence", 0.0)))

            # No sighting inside the goal/net: filter obvious shoe FPs & teleports
            # before letting a field-side ball cancel the pending goal.
            last_pos = cand.get("last_pos")
            dt_cand = max(0.03, t - cand["last_inside_t"])
            plausible = []
            for b in yolo_balls:
                centre = _ball_points(b)[0]
                if (
                    self._is_player_foot_fp(b, detections, mouth)
                    and last_pos is not None
                    and math.hypot(centre[0] - last_pos[0], centre[1] - last_pos[1])
                    > 6.0
                ):
                    continue
                if last_pos is not None and dt_cand <= 1.0:
                    dist = math.hypot(centre[0] - last_pos[0], centre[1] - last_pos[1])
                    if dist > 95.0 * dt_cand + 14.0:
                        continue
                plausible.append(b)
            if not plausible:
                return None
            if last_pos is not None:
                return min(
                    plausible,
                    key=lambda d: math.hypot(
                        _ball_points(d)[0][0] - last_pos[0],
                        _ball_points(d)[0][1] - last_pos[1],
                    ),
                )
            return max(plausible, key=lambda d: float(d.get("confidence", 0.0)))

        # No active candidate: pick the best spatially consistent ball.
        candidates = yolo_balls + motion_balls
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]

        if self.ball_history:
            pt, prev_centre = self.ball_history[-1][0], self.ball_history[-1][1]
            dt = t - pt
            if 0.0 < dt <= 1.0:
                max_jump = 95.0 * dt + 14.0
                near = [
                    b
                    for b in candidates
                    if math.hypot(
                        _ball_points(b)[0][0] - prev_centre[0],
                        _ball_points(b)[0][1] - prev_centre[1],
                    )
                    <= max_jump
                ]
                if near:
                    # Prefer higher confidence among spatially continuous balls,
                    # lightly penalising distance from the previous position.
                    return max(
                        near,
                        key=lambda b: (
                            float(b.get("confidence", 0.0))
                            - 0.015
                            * math.hypot(
                                _ball_points(b)[0][0] - prev_centre[0],
                                _ball_points(b)[0][1] - prev_centre[1],
                            )
                        ),
                    )
        # Prefer real YOLO detections over motion rescue if no spatial tie-breaker.
        if yolo_balls:
            return max(yolo_balls, key=lambda d: float(d.get("confidence", 0.0)))
        return motion_balls[0]

    def update(
        self,
        detections: list[dict[str, Any]],
        timestamp: float | None = None,
        frame_index: int | None = None,
        carrier: dict[str, Any] | None = None,
        frame_bgr: np.ndarray | None = None,
        roi_only: bool = False,
    ) -> dict[str, Any] | None:
        """Process one sample. Returns a goal event when a goal is confirmed.

        ``roi_only`` marks a motion-only sample between YOLO strides: its detections
        are stale, so in auto mode goal boxes are not re-tracked and only goals that
        stayed put (plus a pending goal's mouth) are used.
        """
        t = self._time(timestamp)
        self.last_t = t
        self.samples += 1
        if not self.enabled:
            return None
        if self.mode == "landmarks":
            self._active_mouths = self.goal_mouths
        elif roi_only:
            self._active_mouths = self._stationary_auto_mouths()
            if self.candidate is not None and self.candidate["mouth"].is_auto:
                cand_mouth = self.candidate["mouth"]
                if all(m.id != cand_mouth.id for m in self._active_mouths):
                    self._active_mouths.append(cand_mouth)
                else:
                    self._active_mouths = [
                        cand_mouth if m.id == cand_mouth.id else m
                        for m in self._active_mouths
                    ]
        else:
            self._update_auto_mouths(detections, t)

        ball = self._select_ball(detections, t, frame_bgr)
        sighting = _ball_points(ball) if ball else None
        ball_speed = self._ball_speed(sighting, t)

        event = None
        if t - self.last_goal_t >= self.cooldown_sec:
            event = self._step(detections, sighting, t, frame_index)
        else:
            self.candidate = None

        # Carrier memory is frozen while a goal is pending and updated after the step,
        # so the scorer is the player who had the ball before it went in.
        if event is None and self.candidate is None:
            self._remember_carrier(carrier, t, ball_speed)
        if sighting is not None:
            self.ball_history.append((t, *sighting))
        return event

    def _step(self, detections, sighting, t, frame_index):
        cand = self.candidate

        if sighting is not None:
            centre, ground, height = sighting
            for mouth in self._active_mouths:
                if cand is not None and cand["mouth"] is not mouth:
                    continue
                if cand is not None and mouth.over_crossbar(centre):
                    # Ball in the roof of the net (drawn above the crossbar line on
                    # screen): neither confirms nor cancels the pending goal.
                    return None
                in_mouth = mouth.contains(centre, self._shrink(mouth))
                in_net = cand is not None and mouth.in_net_zone(centre, ground)
                if not (in_mouth or in_net):
                    continue

                reason = self._in_front_reason(mouth, ground, height)
                if reason is not None:
                    # In the mouth on screen, but in front of the goal.
                    self._count_once("in_front_rejections", t)
                    self.candidate = None
                    return None
                if self._held_in_front(detections, mouth, centre):
                    if cand is not None:
                        self.saves += 1
                    self.candidate = None
                    return None

                if cand is None:
                    entry = self._entry(mouth, t)
                    if entry == "over_bar":
                        self._count_once("over_bar", t)
                    if entry != "mouth":
                        return None
                    self.candidate = {
                        "mouth": mouth,
                        "first_t": t,
                        "last_inside_t": t,
                        "last_pos": centre,
                        "inside_samples": 1,
                        "outside_streak": 0,
                        "frame_index": frame_index,
                    }
                    cand = self.candidate
                else:
                    cand["last_inside_t"] = t
                    cand["last_pos"] = centre
                    cand["inside_samples"] += 1
                    cand["outside_streak"] = 0

                if (
                    cand["inside_samples"] >= self.min_inside_samples
                    and t - cand["first_t"] >= self.min_inside_sec
                ):
                    return self._confirm(cand, t, "dwell")
                return None

            # Ball visible outside the mouth and net zone: require consecutive
            # field-side sightings before cancelling so a 1-frame flicker doesn't
            # erase a real goal.
            if cand is not None:
                cand["outside_streak"] = cand.get("outside_streak", 0) + 1
                if cand["outside_streak"] >= self.cancel_outside_samples:
                    self.candidate = None
            return None

        if cand is None:
            return None
        if t - cand["last_inside_t"] >= self.hidden_confirm_sec:
            # One inside sighting followed by a missed detection is too weak.
            if cand["inside_samples"] >= 2:
                return self._confirm(cand, t, "hidden_in_net")
            self.candidate = None
        return None

    def _confirm(self, cand: dict[str, Any], t: float, reason: str) -> dict[str, Any]:
        self.candidate = None
        self.last_goal_t = t
        mouth: GoalMouth = cand["mouth"]
        last = self.last_carrier
        recent = (
            last is not None and cand["first_t"] - last["t"] <= self.carrier_memory_sec
        )
        team = last["team_id"] if recent else None
        scorer = last["track_id"] if recent else None
        if team in TEAM_IDS:
            self.score[team] += 1
        else:
            self.unattributed += 1

        confidence = min(
            1.0,
            0.45
            + 0.25 * min(1.0, cand["inside_samples"] / 5.0)
            + (0.1 if reason == "dwell" else 0.0)
            + (0.2 if team is not None else 0.0),
        )
        if team is None:
            desc = f"GOAL! ({mouth.label}, scorer not identified)"
        else:
            desc = f"GOAL! Team {team}" + (
                f" scored by #{scorer}" if scorer is not None else ""
            )

        event = {
            "id": f"goal-{len(self.goals) + 1}",
            "type": "goal",
            "timestamp": round(cand["first_t"], 3),
            "confirmed_at": round(t, 3),
            "frame_index": cand["frame_index"],
            "team": team,
            "scorer": scorer,
            "attribution": "last_carrier" if team is not None else "unknown",
            "goal_id": mouth.id,
            "goal_label": mouth.label,
            "goal_side": mouth.side,
            "detection_mode": "auto" if mouth.is_auto else "landmarks",
            # Detected goal box [x, y, w, h] (auto mode) and which half of the screen
            # the goal is on, so pitch analytics can infer the end without landmarks.
            "goal_box": mouth.extra.get("box"),
            "screen_side": "left" if sum(mouth.bbox()[::2]) / 2.0 < 50.0 else "right",
            "confirmation": reason,
            "inside_samples": cand["inside_samples"],
            "inside_sec": round(cand["last_inside_t"] - cand["first_t"], 3),
            "confidence": round(confidence, 2),
            "score": {"team_1": self.score[1], "team_2": self.score[2]},
            "description": desc,
        }
        self.goals.append(event)
        return event

    def score_dict(self) -> dict[str, int]:
        return {"team_1": self.score[1], "team_2": self.score[2]}

    def summary(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "goal_detection_mode": self.mode,
            "goals_marked": len(self.goal_mouths),
            "goal_mouths": [m.to_dict() for m in self.goal_mouths],
            "score": {"team_1": self.score[1], "team_2": self.score[2]},
            "total_goals": len(self.goals),
            "unattributed_goals": self.unattributed,
            "saves": self.saves,
            "over_bar": self.over_bar,
            "in_front_rejections": self.in_front_rejections,
            "goals": list(self.goals),
        }
