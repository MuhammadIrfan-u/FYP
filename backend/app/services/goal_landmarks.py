"""Manually placed goal landmarks: geometry and per-video storage.

Before analysis the user clicks the four corners of each goal mouth on a still frame
of the video:

* ``post_left_bottom``  - foot of the post on the left of the screen
* ``post_right_bottom`` - foot of the post on the right of the screen
* ``post_right_top``    - top of the right post (right end of the crossbar)
* ``post_left_top``     - top of the left post (left end of the crossbar)

The points are stored as percentages of the frame, so they apply to any resolution
the video is processed at. They are fixed screen positions, so they only describe
the goal correctly while the camera does not move (training cameras, tripods,
tactical cameras).

Geometry used by the goal detector (all in percent coordinates):

* **Goal mouth** - the quadrilateral of the four corners.
* **Goal line** - the segment between the two post feet. With an elevated camera a
  ground point *behind* the line (inside the net) is drawn on the crossbar side of
  that line on screen, while a ground point *in front of* the goal is drawn on the
  other side. This is what separates "ball in the net" from "ball in front of the
  goal" for a ball on the ground.
* **Crossbar line** - the segment between the two post tops; a ball between the posts
  and beyond this line on screen is over the bar.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

POINT_IDS = ("post_left_bottom", "post_right_bottom", "post_right_top", "post_left_top")
POINT_LABELS = {
    "post_left_bottom": "Left post - bottom (on the goal line)",
    "post_right_bottom": "Right post - bottom (on the goal line)",
    "post_right_top": "Right post - top (crossbar corner)",
    "post_left_top": "Left post - top (crossbar corner)",
}
PITCH_SIDES = ("left", "right")

# Real goal: 7.32 m wide, 2.44 m high; a size-5 ball is ~0.22 m across.
BALL_TO_GOAL_HEIGHT = 0.22 / 2.44

Point = tuple[float, float]


def _cross(o: Point, a: Point, b: Point) -> float:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _point_in_polygon(pt: Point, poly: list[Point]) -> bool:
    """Ray casting; works for any simple (convex or concave) polygon."""
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            x_cross = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < x_cross:
                inside = not inside
    return inside


def _polygon_area(poly: list[Point]) -> float:
    return 0.5 * abs(
        sum(
            poly[i][0] * poly[(i + 1) % len(poly)][1]
            - poly[(i + 1) % len(poly)][0] * poly[i][1]
            for i in range(len(poly))
        )
    )


@dataclass
class GoalMouth:
    """One goal mouth on screen, in percent coordinates (0-100)."""

    id: str
    post_left_bottom: Point
    post_right_bottom: Point
    post_right_top: Point
    post_left_top: Point
    side: str | None = None  # pitch end this goal is at ("left" / "right"), optional
    label: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    # -- construction / serialisation ------------------------------------

    @classmethod
    def from_points(
        cls,
        goal_id: str,
        points: dict[str, Point],
        side: str | None = None,
        label: str = "",
    ) -> GoalMouth:
        missing = [p for p in POINT_IDS if p not in points]
        if missing:
            raise ValueError(
                f"Goal '{goal_id}' is missing points: {', '.join(missing)}"
            )
        mouth = cls(
            id=goal_id,
            post_left_bottom=tuple(map(float, points["post_left_bottom"])),
            post_right_bottom=tuple(map(float, points["post_right_bottom"])),
            post_right_top=tuple(map(float, points["post_right_top"])),
            post_left_top=tuple(map(float, points["post_left_top"])),
            side=side if side in PITCH_SIDES else None,
            label=label or goal_id,
        )
        mouth.validate()
        return mouth

    @classmethod
    def from_detection_box(
        cls,
        goal_id: str,
        box: tuple[float, float, float, float],
        crossbar_margin: float = 0.08,
        post_margin: float = 0.06,
        label: str = "",
    ) -> GoalMouth:
        """Goal mouth from a YOLO ``football goal`` box ``(x, y, w, h)`` in percent.

        Used by automatic goal detection when no landmarks are marked. The box
        covers posts, crossbar and net, so the mouth is the box with the posts
        moved in by ``post_margin`` and the crossbar down by ``crossbar_margin``
        (fractions of the box). The bottom edge stays flush with the box bottom,
        which is taken as the goal line. ``extra["auto"]`` marks it as automatic.
        """
        x, y, w, h = (float(v) for v in box)
        left, right = x + post_margin * w, x + (1.0 - post_margin) * w
        top, bottom = y + crossbar_margin * h, y + h
        mouth = cls(
            id=goal_id,
            post_left_bottom=(left, bottom),
            post_right_bottom=(right, bottom),
            post_right_top=(right, top),
            post_left_top=(left, top),
            side=None,
            label=label or goal_id,
            extra={"auto": True, "box": [round(v, 3) for v in (x, y, w, h)]},
        )
        mouth.validate()
        return mouth

    @property
    def is_auto(self) -> bool:
        """True for a goal mouth built from a YOLO detection (not user-marked)."""
        return bool(self.extra.get("auto"))

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "side": self.side,
            "label": self.label,
            "points": {
                pid: [round(v, 3) for v in getattr(self, pid)] for pid in POINT_IDS
            },
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GoalMouth:
        return cls.from_points(
            str(data["id"]),
            {k: tuple(v) for k, v in data["points"].items()},
            side=data.get("side"),
            label=data.get("label", ""),
        )

    def validate(self) -> None:
        poly = self.polygon()
        if _polygon_area(poly) < 0.05:  # < 0.05 % of the frame: clicks collapsed
            raise ValueError(
                f"Goal '{self.id}': the four corners are too close together."
            )
        if self.post_height() <= 0:
            raise ValueError(
                f"Goal '{self.id}': post tops must be above the post bottoms on screen."
            )
        if self.post_left_bottom[0] >= self.post_right_bottom[0]:
            raise ValueError(
                f"Goal '{self.id}': the left post must be left of the right post on screen."
            )

    # -- geometry ---------------------------------------------------------

    def polygon(self, shrink: float = 0.0) -> list[Point]:
        """Mouth corners; ``shrink`` (0-1) pulls posts inward and crossbar down.

        The bottom edge stays flush with the goal line so low ground shots
        rolling across the line are not excluded before the goal-line check.
        """
        lb, rb, rt, lt = (
            self.post_left_bottom,
            self.post_right_bottom,
            self.post_right_top,
            self.post_left_top,
        )
        if shrink <= 0:
            return [lb, rb, rt, lt]
        s = min(0.45, shrink / 2.0)

        def lerp(a: Point, b: Point, t: float) -> Point:
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

        lb_s = lerp(lb, rb, s)
        rb_s = lerp(rb, lb, s)
        lt_in = lerp(lt, rt, s)
        rt_in = lerp(rt, lt, s)
        lt_s = lerp(lt_in, lb_s, shrink)
        rt_s = lerp(rt_in, rb_s, shrink)
        return [lb_s, rb_s, rt_s, lt_s]

    def bbox(self) -> tuple[float, float, float, float]:
        pts = self.polygon()
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        return min(xs), min(ys), max(xs), max(ys)

    def net_depth_vector(self) -> Point:
        """Screen-space shift from the front mouth plane to the back of the net.

        Derived from the inward normal of the goal line pointing toward the
        crossbar. Front-on cameras have a horizontal goal line (nx ~ 0), so
        the net sits directly behind the mouth (dx = 0); angled cameras tilt
        the goal line and project the net depth sideways in the direction of
        ``nx``.
        """
        a, b = self.post_left_bottom, self.post_right_bottom
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = (dx * dx + dy * dy) ** 0.5
        if length <= 1e-6:
            return (0.0, 0.0)
        # Candidate unit normal perpendicular to the goal line.
        nx, ny = -dy / length, dx / length
        top_mid = (
            (self.post_left_top[0] + self.post_right_top[0]) / 2.0,
            (self.post_left_top[1] + self.post_right_top[1]) / 2.0,
        )
        # Orient the normal toward the crossbar (the net side).
        if (top_mid[0] - a[0]) * nx + (top_mid[1] - a[1]) * ny < 0:
            nx, ny = -nx, -ny
        if abs(nx) < 0.08:
            return (0.0, 0.0)
        x1, y1, x2, y2 = self.bbox()
        gw, gh = x2 - x1, y2 - y1
        angle_scale = min(1.0, abs(nx) / 0.35)
        sign_x = 1.0 if nx > 0 else -1.0
        return (sign_x * 0.95 * gw * angle_scale, -0.12 * gh * angle_scale)

    def net_polygon(self) -> list[Point]:
        """Outer 2D silhouette covering the goal mouth plus angled net depth."""
        lb, rb, rt, lt = self.polygon(0.0)
        dx, dy = self.net_depth_vector()
        if abs(dx) < 1e-6 and abs(dy) < 1e-6:
            return [lb, rb, rt, lt]

        def shift(p: Point) -> Point:
            return (p[0] + dx, p[1] + dy)

        if dx > 0:
            # Net projects to the right of the front mouth.
            return [lb, rb, shift(rb), shift(rt), shift(lt), lt]
        # Net projects to the left of the front mouth.
        return [shift(lb), lb, rb, rt, shift(rt), shift(lt)]

    def in_net_zone(self, centre: Point, ground: Point | None = None) -> bool:
        """True if the ball lies inside the mouth or its angled back-net zone."""
        if not _point_in_polygon(centre, self.net_polygon()):
            return False
        return ground is None or self.behind_goal_line(ground, 0.0)

    def roi_bbox(
        self, pad_approach: float = 0.6, pad_net: float = 0.25, pad_y: float = 0.25
    ) -> tuple[float, float, float, float]:
        """Padded percent bbox covering the mouth, back net, and near approach."""
        pts = self.net_polygon()
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
        dx, _ = self.net_depth_vector()
        mx1, my1, mx2, my2 = self.bbox()
        gw, gh = mx2 - mx1, my2 - my1
        if dx > 0:
            left_pad, right_pad = pad_approach * gw, pad_net * gw
        elif dx < 0:
            left_pad, right_pad = pad_net * gw, pad_approach * gw
        else:
            left_pad = right_pad = pad_approach * gw
        return (
            max(0.0, x1 - left_pad),
            max(0.0, y1 - pad_y * gh),
            min(100.0, x2 + right_pad),
            min(100.0, y2 + pad_y * gh),
        )

    def post_height(self) -> float:
        """Mean on-screen post height in percent of frame height."""
        left = self.post_left_bottom[1] - self.post_left_top[1]
        right = self.post_right_bottom[1] - self.post_right_top[1]
        return (left + right) / 2.0

    def contains(self, pt: Point, shrink: float = 0.05) -> bool:
        """Point inside the goal mouth (slightly shrunk so posts/bar edges don't count)."""
        return _point_in_polygon(pt, self.polygon(shrink))

    def behind_goal_line(self, ground_pt: Point, tolerance: float = 0.0) -> bool:
        """Ground point on the net side of the goal line (crossbar side on screen)."""
        a, b = self.post_left_bottom, self.post_right_bottom
        top_mid = (
            (self.post_left_top[0] + self.post_right_top[0]) / 2.0,
            (self.post_left_top[1] + self.post_right_top[1]) / 2.0,
        )
        ref = _cross(a, b, top_mid)
        val = _cross(a, b, ground_pt)
        if ref == 0:
            return False
        length = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5 or 1.0
        signed_dist = val / length * (1 if ref > 0 else -1)
        return signed_dist > tolerance

    def between_posts(self, pt: Point) -> bool:
        lx = min(self.post_left_bottom[0], self.post_left_top[0])
        rx = max(self.post_right_bottom[0], self.post_right_top[0])
        return lx <= pt[0] <= rx

    def over_crossbar(self, pt: Point) -> bool:
        """Between the posts but beyond the crossbar line on screen."""
        if not self.between_posts(pt):
            return False
        a, b = self.post_left_top, self.post_right_top
        bottom_mid = (
            (self.post_left_bottom[0] + self.post_right_bottom[0]) / 2.0,
            (self.post_left_bottom[1] + self.post_right_bottom[1]) / 2.0,
        )
        ref = _cross(a, b, bottom_mid)
        val = _cross(a, b, pt)
        return ref != 0 and (val > 0) != (ref > 0)

    def expected_ball_height(self) -> float:
        """On-screen ball height (percent of frame height) for a ball at the goal."""
        return self.post_height() * BALL_TO_GOAL_HEIGHT


# ---------------------------------------------------------------------------
# Per-video storage (next to the pitch calibration files)
# ---------------------------------------------------------------------------


def goal_landmarks_path(calib_dir: Path, video_filename: str) -> Path:
    safe = "".join(
        c if c.isalnum() or c in "._-" else "_" for c in Path(video_filename).name
    )
    return calib_dir / f"{safe}.goals.json"


def goals_from_pixels(
    goals: list[dict[str, Any]], image_width: int, image_height: int
) -> list[GoalMouth]:
    """Build goal mouths from clicked pixel points ``{id, side, label, points:[{id,x,y}]}``."""
    if image_width <= 0 or image_height <= 0:
        raise ValueError("Image size must be positive.")
    if not goals:
        raise ValueError("Mark at least one goal.")
    mouths = []
    seen = set()
    for i, g in enumerate(goals):
        goal_id = str(g.get("id") or f"goal_{i + 1}")
        if goal_id in seen:
            raise ValueError(f"Duplicate goal id '{goal_id}'.")
        seen.add(goal_id)
        pts = {
            str(p["id"]): (
                float(p["x"]) / image_width * 100.0,
                float(p["y"]) / image_height * 100.0,
            )
            for p in g.get("points", [])
        }
        mouths.append(
            GoalMouth.from_points(
                goal_id, pts, side=g.get("side"), label=g.get("label", "")
            )
        )
    return mouths


def save_goal_landmarks(
    calib_dir: Path,
    video_filename: str,
    mouths: list[GoalMouth],
    image_width: int,
    image_height: int,
) -> dict[str, Any]:
    calib_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "video_filename": Path(video_filename).name,
        "image_width": int(image_width),
        "image_height": int(image_height),
        "goals": [m.to_dict() for m in mouths],
    }
    goal_landmarks_path(calib_dir, video_filename).write_text(
        json.dumps(data, indent=2), encoding="utf-8"
    )
    return data


def load_goal_landmarks_data(
    calib_dir: Path, video_filename: str
) -> dict[str, Any] | None:
    path = goal_landmarks_path(calib_dir, video_filename)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        [GoalMouth.from_dict(g) for g in data.get("goals", [])]  # validate
        return data
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


def load_goal_mouths(calib_dir: Path, video_filename: str | None) -> list[GoalMouth]:
    if not video_filename:
        return []
    data = load_goal_landmarks_data(calib_dir, video_filename)
    if not data:
        return []
    return [GoalMouth.from_dict(g) for g in data.get("goals", [])]


def delete_goal_landmarks(calib_dir: Path, video_filename: str) -> bool:
    path = goal_landmarks_path(calib_dir, video_filename)
    if path.exists():
        path.unlink()
        return True
    return False
