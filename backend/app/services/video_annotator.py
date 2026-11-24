import json
import logging
import math
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from app.services.team_possession import TeamPossessionTracker, hex_to_bgr

try:
    import imageio_ffmpeg

    FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # noqa: BLE001
    FFMPEG_EXE = "ffmpeg"


logger = logging.getLogger("video_annotator")

# Global thread-safe job store
JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()

# Tactical BGR colors for each class
CLASS_COLORS: dict[str, tuple[int, int, int]] = {
    "player": (110, 235, 131),  # Emerald green
    "football": (0, 215, 255),  # Electric yellow/gold
    "football goal": (34, 126, 255),  # Vibrant orange
    "player with ball": (255, 90, 220),  # Magenta / neon purple
}
DEFAULT_COLOR = (200, 200, 200)
CARRIER_GOLD = (0, 200, 255)  # BGR gold
LOST_RED = (40, 40, 220)
NOT_LOST_GREEN = (70, 175, 30)
BANNER_DURATION_SEC = 1.6


def get_class_color(cls_name: str) -> tuple[int, int, int]:
    name = cls_name.lower().strip()
    return CLASS_COLORS.get(name, DEFAULT_COLOR)


def draw_hud_header(
    frame: np.ndarray,
    chunk_idx: int,
    total_chunks: int,
    start_sec: float,
    end_sec: float,
    counts: dict[str, int],
) -> int:
    """Draws a sleek tactical status bar at the top of the video frame. Returns its height."""
    h, w = frame.shape[:2]
    header_h = max(28, int(h * 0.055))

    # Translucent dark strip
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, header_h), (20, 20, 20), -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)

    # Status text
    chunk_info = (
        f"5s CHUNK {chunk_idx + 1}/{total_chunks} [{start_sec:.1f}s - {end_sec:.1f}s]"
    )
    stats_info = (
        f"Players: {counts.get('player', 0)} | "
        f"Ball: {counts.get('football', 0)} | "
        f"Goals: {counts.get('football goal', 0)} | "
        f"Ball-carrier: {counts.get('player with ball', 0)}"
    )

    font_scale = max(0.4, w / 2200.0)
    thickness = 1

    # Left indicator
    cv2.circle(frame, (16, header_h // 2), 5, (0, 255, 0), -1, cv2.LINE_AA)
    cv2.putText(
        frame,
        chunk_info,
        (28, header_h // 2 + 5),
        cv2.FONT_HERSHEY_SIMPLEX,
        font_scale,
        (255, 255, 255),
        thickness,
        cv2.LINE_AA,
    )

    # Right indicator
    (text_w, _), _ = cv2.getTextSize(
        stats_info, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness
    )
    right_x = max(w - text_w - 16, w // 2)
    cv2.putText(
        frame,
        stats_info,
        (right_x, header_h // 2 + 5),
        cv2.FONT_HERSHEY_SIMPLEX,
        font_scale,
        (220, 220, 220),
        thickness,
        cv2.LINE_AA,
    )
    return header_h


def draw_detection_box(
    frame: np.ndarray,
    det: dict[str, Any],
) -> None:
    """Draws a professional tactical bounding box and label badge onto the frame."""
    h, w = frame.shape[:2]
    x_pct = det.get("x", 0.0)
    y_pct = det.get("y", 0.0)
    w_pct = det.get("w", 0.0)
    h_pct = det.get("h", 0.0)

    x1 = round((x_pct / 100.0) * w)
    y1 = round((y_pct / 100.0) * h)
    x2 = round(((x_pct + w_pct) / 100.0) * w)
    y2 = round(((y_pct + h_pct) / 100.0) * h)

    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w - 1, x2), min(h - 1, y2)

    if x2 <= x1 or y2 <= y1:
        return

    cls_name = det.get("class", "object")
    conf = float(det.get("confidence", 0.0))
    color = get_class_color(cls_name)
    team_hex = det.get("team_color_hex")
    if team_hex:
        color = hex_to_bgr(team_hex, default=color)
    has_ball = bool(det.get("has_ball"))

    # Ball carrier: gold ground ring under the feet + gold outline
    if has_ball:
        feet = ((x1 + x2) // 2, y2)
        axes = (max(8, (x2 - x1) // 2 + 6), max(4, (x2 - x1) // 6 + 3))
        cv2.ellipse(frame, feet, axes, 0, 0, 360, CARRIER_GOLD, 3, cv2.LINE_AA)
        cv2.rectangle(
            frame, (x1 - 2, y1 - 2), (x2 + 2, y2 + 2), CARRIER_GOLD, 2, cv2.LINE_AA
        )

    # Main bounding rectangle
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)

    # Tactical corner markers
    corner_len = max(6, min(20, int((x2 - x1) * 0.2)))
    cv2.line(frame, (x1, y1), (x1 + corner_len, y1), color, 3, cv2.LINE_AA)
    cv2.line(frame, (x1, y1), (x1, y1 + corner_len), color, 3, cv2.LINE_AA)
    cv2.line(frame, (x2, y1), (x2 - corner_len, y1), color, 3, cv2.LINE_AA)
    cv2.line(frame, (x2, y1), (x2, y1 + corner_len), color, 3, cv2.LINE_AA)
    cv2.line(frame, (x1, y2), (x1 + corner_len, y2), color, 3, cv2.LINE_AA)
    cv2.line(frame, (x1, y2), (x1, y2 - corner_len), color, 3, cv2.LINE_AA)
    cv2.line(frame, (x2, y2), (x2 - corner_len, y2), color, 3, cv2.LINE_AA)
    cv2.line(frame, (x2, y2), (x2, y2 - corner_len), color, 3, cv2.LINE_AA)

    # Label text: e.g. "football goal 38%" or "T1 #8 BALL 87%"
    if det.get("track_id") is not None and det.get("team_id") is not None:
        team_id = det.get("team_id")
        team_tag = f"T{team_id}" if team_id in (1, 2) else "OTH"
        ball_tag = " BALL" if has_ball else ""
        label_text = f"{team_tag} #{det.get('track_id')}{ball_tag} {int(conf * 100)}%"
    else:
        label_text = f"{cls_name.capitalize()} {int(conf * 100)}%"
    font_scale = max(0.35, min(0.65, w / 2400.0))
    thickness = 1
    (lbl_w, lbl_h), _baseline = cv2.getTextSize(
        label_text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness
    )

    badge_y1 = max(0, y1 - lbl_h - 8)
    badge_y2 = y1
    badge_x2 = min(w, x1 + lbl_w + 10)

    # Dark filled badge background
    cv2.rectangle(frame, (x1, badge_y1), (badge_x2, badge_y2), (25, 25, 25), -1)
    cv2.rectangle(
        frame,
        (x1, badge_y1),
        (badge_x2, badge_y2),
        CARRIER_GOLD if has_ball else color,
        1,
        cv2.LINE_AA,
    )

    # Badge text
    cv2.putText(
        frame,
        label_text,
        (x1 + 5, badge_y2 - 4),
        cv2.FONT_HERSHEY_SIMPLEX,
        font_scale,
        (255, 255, 255),
        thickness,
        cv2.LINE_AA,
    )


def _put(frame, text, org, scale, color, thick=1, font=cv2.FONT_HERSHEY_SIMPLEX):
    cv2.putText(frame, text, org, font, scale, color, thick, cv2.LINE_AA)


def draw_possession_hud(
    frame: np.ndarray,
    state: dict[str, Any] | None,
    top_offset: int,
) -> None:
    """Team 1 vs Team 2 possession strip with kit swatches, split bar and counters."""
    if not state:
        return
    h, w = frame.shape[:2]
    strip_h = max(26, int(h * 0.05))
    y0 = top_offset
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, y0), (w, y0 + strip_h), (15, 15, 15), -1)
    cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)

    teams = {t["team_id"]: t for t in state.get("teams", [])}
    pct = state.get("possession_percent", {})
    p1, p2 = float(pct.get("team_1", 0.0)), float(pct.get("team_2", 0.0))
    font_scale = max(0.38, w / 2600.0)
    mid_y = y0 + strip_h // 2
    white = (255, 255, 255)

    def team_text(team_id: int, value: float) -> str:
        t = teams.get(team_id, {})
        name = t.get("color_name") or "?"
        losses, passes = t.get("losses", 0), t.get("passes", 0)
        return f"TEAM {team_id} ({name}) {value:.0f}%  L:{losses} P:{passes}"

    sw = max(10, strip_h // 2)
    c1 = hex_to_bgr(teams.get(1, {}).get("color_hex"))
    c2 = hex_to_bgr(teams.get(2, {}).get("color_hex"))
    sy1, sy2 = mid_y - sw // 2, mid_y + sw // 2

    # Left: team 1
    cv2.rectangle(frame, (10, sy1), (10 + sw, sy2), c1, -1)
    cv2.rectangle(frame, (10, sy1), (10 + sw, sy2), white, 1)
    _put(frame, team_text(1, p1), (16 + sw, mid_y + 5), font_scale, white)

    # Right: team 2
    t2 = team_text(2, p2)
    (tw, _), _ = cv2.getTextSize(t2, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)
    rx = w - 10 - sw
    cv2.rectangle(frame, (rx, sy1), (rx + sw, sy2), c2, -1)
    cv2.rectangle(frame, (rx, sy1), (rx + sw, sy2), white, 1)
    _put(frame, t2, (rx - 6 - tw, mid_y + 5), font_scale, white)

    # Centre split bar
    bar_w = max(60, int(w * 0.18))
    bx1 = w // 2 - bar_w // 2
    by1, by2 = mid_y - 4, mid_y + 4
    total = p1 + p2
    split = bx1 + (int(bar_w * p1 / total) if total > 0 else bar_w // 2)
    cv2.rectangle(frame, (bx1, by1), (split, by2), c1, -1)
    cv2.rectangle(frame, (split, by1), (bx1 + bar_w, by2), c2, -1)
    cv2.rectangle(frame, (bx1, by1), (bx1 + bar_w, by2), white, 1)

    carrier = state.get("carrier")
    status = state.get("status", "idle")
    if carrier and carrier.get("track_id") is not None:
        status_text = f"BALL: {carrier.get('team_label')} #{carrier.get('track_id')}"
    elif status == "in_transit":
        status_text = "BALL IN TRANSIT"
    else:
        status_text = "NO CARRIER"
    small = font_scale * 0.9
    (st_w, _), _ = cv2.getTextSize(status_text, cv2.FONT_HERSHEY_SIMPLEX, small, 1)
    ty = y0 + strip_h + 14
    _put(frame, status_text, (w // 2 - st_w // 2, ty), small, CARRIER_GOLD)


def draw_possession_banner(
    frame: np.ndarray,
    event: dict[str, Any],
    progress: float,
) -> None:
    """Animated centre banner: slides/scales in, pulses, then fades out.

    ``progress`` runs 0 -> 1 over the banner lifetime.
    """
    h, w = frame.shape[:2]
    lost = event.get("status") == "lost"
    title = "POSSESSION LOST!" if lost else "POSSESSION NOT LOST (SAME TEAM)"
    color = LOST_RED if lost else NOT_LOST_GREEN
    sub = str(event.get("description", ""))

    # Ease in for the first 15%, fade out over the last 25%.
    if progress < 0.15:
        appear = progress / 0.15
    elif progress > 0.75:
        appear = max(0.0, (1.0 - progress) / 0.25)
    else:
        appear = 1.0
    pulse = 0.5 + 0.5 * math.sin(progress * math.pi * 6)

    scale = max(0.6, w / 1100.0) * (0.85 + 0.15 * appear)
    thick = max(2, round(scale * 2))
    (tw, th), _ = cv2.getTextSize(title, cv2.FONT_HERSHEY_DUPLEX, scale, thick)
    sub_scale = scale * 0.45
    (sw, sh), _ = cv2.getTextSize(sub, cv2.FONT_HERSHEY_SIMPLEX, sub_scale, 1)

    pad = int(14 * scale)
    box_w = min(w - 4, max(tw, sw) + pad * 2)
    box_h = th + sh + pad * 3
    cx = w // 2
    cy = int(h * 0.30 - (1.0 - appear) * h * 0.06)
    x1, y1 = max(2, cx - box_w // 2), max(2, cy - box_h // 2)
    x2, y2 = min(w - 2, x1 + box_w), min(h - 2, y1 + box_h)

    alpha = 0.82 * appear
    overlay = frame.copy()
    cv2.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)
    border = tuple(int(c + (255 - c) * pulse * 0.6) for c in color)
    cv2.rectangle(frame, (x1, y1), (x2, y2), border, thick, cv2.LINE_AA)

    if appear > 0.05:
        white = (255, 255, 255)
        _put(
            frame,
            title,
            (cx - tw // 2, y1 + pad + th),
            scale,
            white,
            thick,
            cv2.FONT_HERSHEY_DUPLEX,
        )
        _put(frame, sub, (cx - sw // 2, y1 + pad * 2 + th + sh), sub_scale, white)


def encode_chunk_ffmpeg(
    frames: list[np.ndarray],
    output_path: Path,
    fps: float,
    width: int,
    height: int,
) -> bool:
    """Encodes a list of annotated frames into an H.264 MP4 file using ffmpeg."""
    cmd = [
        FFMPEG_EXE,
        "-y",
        "-f",
        "rawvideo",
        "-vcodec",
        "rawvideo",
        "-s",
        f"{width}x{height}",
        "-pix_fmt",
        "bgr24",
        "-r",
        str(fps),
        "-i",
        "-",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(output_path),
    ]

    try:
        raw_data = b"".join(f.tobytes() for f in frames)
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        proc.communicate(input=raw_data, timeout=30)
        return (
            proc.returncode == 0
            and output_path.exists()
            and output_path.stat().st_size > 0
        )
    except Exception as e:  # noqa: BLE001
        logger.error(f"FFmpeg encoding error for {output_path}: {e}")
        return False


def concatenate_chunks_ffmpeg(
    chunk_paths: list[Path],
    output_path: Path,
) -> bool:
    """Concatenates all chunk MP4s into a single full annotated MP4 file."""
    list_file = output_path.parent / "concat_list.txt"
    try:
        with open(list_file, "w", encoding="utf-8") as f:
            f.writelines(f"file '{p.name}'\n" for p in chunk_paths)

        cmd = [
            FFMPEG_EXE,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
        res = subprocess.run(
            cmd,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        if list_file.exists():
            list_file.unlink()
        return (
            res.returncode == 0
            and output_path.exists()
            and output_path.stat().st_size > 0
        )
    except Exception as e:  # noqa: BLE001
        logger.error(f"FFmpeg concatenate error for {output_path}: {e}")
        if list_file.exists():
            list_file.unlink()
        return False


MAX_OUTPUT_WIDTH = 1920
TEAM_FALLBACK_BGR = {1: (235, 160, 40), 2: (40, 60, 230)}
EVENT_BANNER_STYLE = {
    "goal": ("GOAL!", (0, 190, 255)),
    "pass": ("PASS", NOT_LOST_GREEN),
    "interception": ("INTERCEPTION", LOST_RED),
    "tackle": ("BALL WON", LOST_RED),
    "out": ("OUT OF PLAY", (120, 120, 120)),
}


def output_size(
    width: int, height: int, max_width: int = MAX_OUTPUT_WIDTH
) -> tuple[int, int]:
    """Even output dimensions, downscaled so wide panoramas stay light to stream."""
    if width > max_width:
        scale = max_width / width
        width, height = max_width, round(height * scale)
    return width - width % 2, height - height % 2


class StreamingChunkEncoder:
    """Pipes frames straight into ffmpeg so a chunk is never buffered in RAM."""

    def __init__(self, output_path: Path, fps: float, width: int, height: int):
        self.output_path = output_path
        self.width, self.height = width, height
        self.frames = 0
        cmd = [
            FFMPEG_EXE,
            "-y",
            "-f",
            "rawvideo",
            "-vcodec",
            "rawvideo",
            "-s",
            f"{width}x{height}",
            "-pix_fmt",
            "bgr24",
            "-r",
            str(fps),
            "-i",
            "-",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def write(self, frame: np.ndarray) -> None:
        if frame.shape[1] != self.width or frame.shape[0] != self.height:
            frame = cv2.resize(
                frame, (self.width, self.height), interpolation=cv2.INTER_AREA
            )
        try:
            self.proc.stdin.write(frame.tobytes())
            self.frames += 1
        except (BrokenPipeError, OSError) as e:
            logger.error(f"FFmpeg pipe error for {self.output_path}: {e}")

    def close(self) -> bool:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
            self.proc.wait(timeout=120)
        except Exception as e:  # noqa: BLE001
            logger.error(f"FFmpeg finalize error for {self.output_path}: {e}")
            self.proc.kill()
            return False
        return (
            self.proc.returncode == 0
            and self.output_path.exists()
            and self.output_path.stat().st_size > 0
        )


def _team_bgr(team: int | None, teams_state: dict[int, Any]) -> tuple[int, int, int]:
    hex_color = (teams_state.get(team) or {}).get("color_hex") if team else None
    return hex_to_bgr(hex_color, default=TEAM_FALLBACK_BGR.get(team, (200, 200, 200)))


def draw_minimap(
    frame: np.ndarray,
    analytics_state: dict[str, Any] | None,
    pitch_length: float,
    pitch_width: float,
    teams_state: dict[int, Any],
) -> None:
    """Top-down 2D pitch (homography view) with players and the ball, bottom-centre."""
    if not analytics_state:
        return
    from app.services.pitch_homography import pitch_line_segments

    h, w = frame.shape[:2]
    map_w = max(160, min(int(w * 0.24), int(h * 0.42 * pitch_length / pitch_width)))
    map_h = int(map_w * pitch_width / pitch_length)
    pad = max(6, map_w // 30)
    x0 = w // 2 - (map_w + 2 * pad) // 2
    y0 = h - map_h - 2 * pad - 8
    overlay = frame.copy()
    cv2.rectangle(
        overlay,
        (x0, y0),
        (x0 + map_w + 2 * pad, y0 + map_h + 2 * pad),
        (40, 95, 30),
        -1,
    )
    cv2.addWeighted(overlay, 0.78, frame, 0.22, 0, frame)
    sx, sy = map_w / pitch_length, map_h / pitch_width
    ox, oy = x0 + pad, y0 + pad

    def to_px(x: float, y: float) -> tuple[int, int]:
        return int(ox + x * sx), int(oy + y * sy)

    for seg in pitch_line_segments(pitch_length, pitch_width, step=2.0):
        pts = np.array([to_px(x, y) for x, y in seg], dtype=np.int32)
        cv2.polylines(frame, [pts], False, (235, 235, 235), 1, cv2.LINE_AA)

    r = max(3, map_w // 90)
    for p in analytics_state.get("players", []):
        c = _team_bgr(p.get("team"), teams_state)
        cx, cy = to_px(p["x"], p["y"])
        cv2.circle(frame, (cx, cy), r, c, -1, cv2.LINE_AA)
        cv2.circle(
            frame,
            (cx, cy),
            r,
            (255, 255, 255) if p.get("has_ball") else (20, 20, 20),
            1,
            cv2.LINE_AA,
        )
        if p.get("has_ball"):
            cv2.circle(frame, (cx, cy), r + 3, CARRIER_GOLD, 2, cv2.LINE_AA)
    ball = analytics_state.get("ball")
    if ball:
        bx, by = to_px(ball[0], ball[1])
        color = (
            (255, 255, 255) if analytics_state.get("ball_detected") else (160, 160, 160)
        )
        cv2.circle(frame, (bx, by), max(2, r - 1), color, -1, cv2.LINE_AA)
        cv2.circle(frame, (bx, by), max(2, r - 1), (0, 0, 0), 1, cv2.LINE_AA)


def draw_scoreboard(
    frame: np.ndarray,
    analytics_state: dict[str, Any] | None,
    teams_state: dict[int, Any],
    top_offset: int,
) -> None:
    """Score + possession % + passes under the possession strip."""
    if not analytics_state:
        return
    _h, w = frame.shape[:2]
    score = analytics_state.get("score", {})
    pct = analytics_state.get("possession_percent", {})
    passes = analytics_state.get("passes", {})
    text = (
        f"T1 {score.get('team_1', 0)} - {score.get('team_2', 0)} T2   |   "
        f"POSS {pct.get('team_1', 0):.0f}% / {pct.get('team_2', 0):.0f}%   |   "
        f"PASSES {passes.get('team_1', 0)} / {passes.get('team_2', 0)}"
    )
    scale = max(0.45, w / 2400.0)
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)
    x1, y1 = w // 2 - tw // 2 - 12, top_offset + 22
    overlay = frame.copy()
    cv2.rectangle(overlay, (x1, y1), (x1 + tw + 24, y1 + th + 14), (15, 15, 15), -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
    cv2.rectangle(
        frame, (x1, y1), (x1 + 8, y1 + th + 14), _team_bgr(1, teams_state), -1
    )
    cv2.rectangle(
        frame,
        (x1 + tw + 16, y1),
        (x1 + tw + 24, y1 + th + 14),
        _team_bgr(2, teams_state),
        -1,
    )
    _put(frame, text, (x1 + 12, y1 + th + 7), scale, (255, 255, 255))


def draw_event_banner(
    frame: np.ndarray, event: dict[str, Any], progress: float
) -> None:
    """Analytics event banner (goal / pass / interception / tackle / out)."""
    title, color = EVENT_BANNER_STYLE.get(event.get("type"), ("EVENT", (90, 90, 90)))
    _draw_banner_titled(frame, title, event, progress, color)


def _draw_banner_titled(
    frame: np.ndarray,
    title: str,
    event: dict[str, Any],
    progress: float,
    color: tuple[int, int, int],
) -> None:
    h, w = frame.shape[:2]
    sub = str(event.get("description", ""))
    appear = (
        progress / 0.15
        if progress < 0.15
        else (max(0.0, (1 - progress) / 0.25) if progress > 0.75 else 1.0)
    )
    pulse = 0.5 + 0.5 * math.sin(progress * math.pi * 6)
    scale = max(0.6, w / 1100.0) * (0.85 + 0.15 * appear)
    thick = max(2, round(scale * 2))
    (tw, th), _ = cv2.getTextSize(title, cv2.FONT_HERSHEY_DUPLEX, scale, thick)
    sub_scale = scale * 0.45
    (sw, sh), _ = cv2.getTextSize(sub, cv2.FONT_HERSHEY_SIMPLEX, sub_scale, 1)
    pad = int(14 * scale)
    box_w, box_h = min(w - 4, max(tw, sw) + pad * 2), th + sh + pad * 3
    cx, cy = w // 2, int(h * 0.30 - (1.0 - appear) * h * 0.06)
    x1, y1 = max(2, cx - box_w // 2), max(2, cy - box_h // 2)
    x2, y2 = min(w - 2, x1 + box_w), min(h - 2, y1 + box_h)
    alpha = 0.82 * appear
    overlay = frame.copy()
    cv2.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)
    border = tuple(int(c + (255 - c) * pulse * 0.6) for c in color)
    cv2.rectangle(frame, (x1, y1), (x2, y2), border, thick, cv2.LINE_AA)
    if appear > 0.05:
        _put(
            frame,
            title,
            (cx - tw // 2, y1 + pad + th),
            scale,
            (255, 255, 255),
            thick,
            cv2.FONT_HERSHEY_DUPLEX,
        )
        _put(
            frame,
            sub,
            (cx - sw // 2, y1 + pad * 2 + th + sh),
            sub_scale,
            (255, 255, 255),
        )


def filter_off_pitch(
    detections: list[dict[str, Any]],
    mapper: Any,
    width: int,
    height: int,
    margin_m: float = 4.0,
) -> list[dict[str, Any]]:
    """Drop players/balls whose ground point maps far outside the pitch (bench, crowd)."""
    keep_classes = ("player", "player with ball", "football")
    targets = [d for d in detections if str(d.get("class", "")).lower() in keep_classes]
    if not targets:
        return detections
    pts = np.array(
        [
            ((d["x"] + d["w"] / 2) / 100.0 * width, (d["y"] + d["h"]) / 100.0 * height)
            for d in targets
        ]
    )
    pitch = mapper.image_to_pitch(pts)
    drop = {
        id(d)
        for d, xy in zip(targets, pitch, strict=False)
        if not (np.all(np.isfinite(xy)) and mapper.is_on_pitch(xy, margin_m))
    }
    return [d for d in detections if id(d) not in drop]


def chunk_possession(
    tracker: TeamPossessionTracker, first_event_number: int
) -> dict[str, Any]:
    """Possession snapshot for one chunk: running totals + events logged in it."""
    summary = tracker.get_summary(max_events=tracker.max_events)
    events = [
        e
        for e in summary["events"]
        if int(str(e["id"]).split("-")[-1]) > first_event_number
    ]
    return {
        "possession_percent": summary["possession_percent"],
        "total_losses": summary["total_losses"],
        "total_passes": summary["total_passes"],
        "events": events,
    }


def _write_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, default=_json_default), encoding="utf-8")
    tmp.replace(path)


def _json_default(o: Any) -> Any:
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


def _log_urls(job_id: str) -> dict[str, str]:
    base = f"/api/videos/jobs/{job_id}"
    return {
        "players_csv": f"{base}/players_log.csv",
        "ball_csv": f"{base}/ball_log.csv",
        "events_json": f"{base}/events.json",
        "match_stats_json": f"{base}/match_stats.json",
        "heatmaps_json": f"{base}/heatmaps.json",
    }


def run_chunked_annotation_worker(
    job_id: str,
    video_source_path: Path,
    output_dir: Path,
    chunk_duration_sec: float,
    confidence_threshold: float,
    class_confidences: dict[str, float],
    burn_boxes: bool,
    parse_detections_fn: Any,
    model_obj: Any,
    infer_fps: float = 15.0,
    detect_fn: Any = None,
    pitch_mapper: Any = None,
    max_duration_sec: float | None = None,
) -> None:
    """Worker function executing in a background thread to annotate 5s chunks progressively.

    Inference runs every ``round(fps / infer_fps)`` frames (e.g. 15 fps -> 2-frame stride
    on 30 fps video) so fast passes and turnovers are caught by the possession tracker.

    With a ``pitch_mapper`` (landmark homography) the worker also projects players and
    the ball onto the pitch, runs ``MatchAnalytics`` (possession, passes, goals, out of
    play), draws a 2D minimap and writes players/ball CSV logs plus events/stats JSON.
    """
    from app.services.match_analytics import MatchAnalytics

    logger.info(f"Starting chunked annotation job {job_id} for {video_source_path}")
    analytics: MatchAnalytics | None = None

    try:
        cap = cv2.VideoCapture(str(video_source_path))
        if not cap.isOpened():
            raise RuntimeError(f"Could not open input video: {video_source_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)
        if max_duration_sec and max_duration_sec > 0 and total_frames > 0:
            total_frames = min(total_frames, round(max_duration_sec * fps))
        duration_sec = total_frames / fps if fps > 0 else 0.0
        out_w, out_h = output_size(width, height)

        chunk_frames_target = max(1, round(fps * chunk_duration_sec))
        total_chunks = (
            max(1, math.ceil(total_frames / chunk_frames_target))
            if total_frames > 0
            else 1
        )

        mapper = (
            pitch_mapper.scaled_to(width, height) if pitch_mapper is not None else None
        )
        output_dir.mkdir(parents=True, exist_ok=True)
        if mapper is not None:
            analytics = MatchAnalytics(mapper, log_dir=output_dir)

        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id]["total_chunks"] = total_chunks
                JOBS[job_id]["duration_sec"] = round(duration_sec, 2)
                JOBS[job_id]["fps"] = round(fps, 1)
                JOBS[job_id]["resolution"] = f"{width}x{height}"
                JOBS[job_id]["output_resolution"] = f"{out_w}x{out_h}"
                JOBS[job_id]["calibrated"] = mapper is not None
                if mapper is not None:
                    JOBS[job_id]["logs"] = _log_urls(job_id)

        chunk_files: list[Path] = []
        frame_idx = 0
        chunk_idx = 0

        effective_infer_fps = max(0.5, min(float(infer_fps or 15.0), fps))
        infer_interval = max(1, round(fps / effective_infer_fps))
        min_conf = min([confidence_threshold, *class_confidences.values()])
        tracker = TeamPossessionTracker()
        latest_state: dict[str, Any] | None = None
        analytics_state: dict[str, Any] | None = None
        banner_event: dict[str, Any] | None = None
        banner_is_analytics = False
        banner_start_frame = 0
        banner_frames = max(1, round(fps * BANNER_DURATION_SEC))

        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id]["infer_fps"] = round(effective_infer_fps, 2)
                JOBS[job_id]["infer_interval_frames"] = infer_interval

        def run_detection(frame: np.ndarray) -> dict[str, Any]:
            if detect_fn is not None:
                return detect_fn(frame)
            results = model_obj(frame, imgsz=480, conf=min_conf, verbose=False)
            return parse_detections_fn(
                results,
                conf_threshold=confidence_threshold,
                class_confidences=class_confidences,
            )

        reached_limit = False
        while not reached_limit:
            chunk_class_counts: dict[str, int] = {
                "player": 0,
                "football": 0,
                "football goal": 0,
                "player with ball": 0,
            }
            chunk_total_detections = 0
            chunk_start_sec = frame_idx / fps
            chunk_output_file = output_dir / f"chunk_{chunk_idx}.mp4"
            encoder: StreamingChunkEncoder | None = None

            frames_in_this_chunk = 0
            latest_parsed: dict[str, Any] = {"detections": [], "class_counts": {}}
            chunk_event_start = tracker.event_counter
            chunk_match_event_start = analytics.event_counter if analytics else 0

            while frames_in_this_chunk < chunk_frames_target:
                if total_frames > 0 and frame_idx >= total_frames:
                    reached_limit = True
                    break
                ret, frame = cap.read()
                if not ret:
                    reached_limit = True
                    break

                if (frames_in_this_chunk % infer_interval == 0) and (
                    model_obj is not None or detect_fn is not None
                ):
                    timestamp = round(frame_idx / fps, 3)
                    try:
                        latest_parsed = run_detection(frame)
                        if mapper is not None:
                            latest_parsed["detections"] = filter_off_pitch(
                                latest_parsed.get("detections", []),
                                mapper,
                                width,
                                height,
                            )
                    except Exception as model_err:  # noqa: BLE001
                        logger.warning(f"Model inference exception: {model_err}")
                        latest_parsed = {"detections": [], "class_counts": {}}

                    try:
                        latest_state = tracker.process_frame(
                            frame,
                            latest_parsed.get("detections", []),
                            timestamp=timestamp,
                        )
                        if analytics is None and latest_state.get("event"):
                            banner_event = latest_state["event"]
                            banner_is_analytics = False
                            banner_start_frame = frame_idx
                    except Exception as track_err:  # noqa: BLE001
                        logger.warning(f"Possession tracking exception: {track_err}")

                    if analytics is not None:
                        try:
                            analytics_state = analytics.process(
                                latest_parsed.get("detections", []),
                                timestamp=timestamp,
                                frame_index=frame_idx,
                                image_width=width,
                                image_height=height,
                            )
                            evts = analytics_state.get("events") or []
                            if evts:
                                # Goals take priority over other banners.
                                evts = sorted(
                                    evts, key=lambda e: e.get("type") != "goal"
                                )
                                banner_event = evts[0]
                                banner_is_analytics = True
                                banner_start_frame = frame_idx
                            # Carrier highlight follows the analytics carrier.
                            carrier_id = (analytics_state.get("carrier") or {}).get(
                                "track_id"
                            )
                            for det in latest_parsed.get("detections", []):
                                if det.get("track_id") is not None:
                                    det["has_ball"] = det.get("track_id") == carrier_id
                        except Exception as an_err:  # noqa: BLE001
                            logger.warning(f"Match analytics exception: {an_err}")

                    counts = latest_parsed.get("class_counts", {})
                    for k, v in counts.items():
                        chunk_class_counts[k] = chunk_class_counts.get(k, 0) + v
                    chunk_total_detections += len(latest_parsed.get("detections", []))

                detections = latest_parsed.get("detections", [])
                counts = latest_parsed.get("class_counts", {})

                if burn_boxes:
                    for det in detections:
                        draw_detection_box(frame, det)

                    header_h = draw_hud_header(
                        frame,
                        chunk_idx=chunk_idx,
                        total_chunks=total_chunks,
                        start_sec=chunk_start_sec,
                        end_sec=chunk_start_sec + (frames_in_this_chunk / fps),
                        counts=counts,
                    )
                    hud_state = latest_state
                    if analytics_state and latest_state:
                        # Show pitch-based possession/passes in the team strip.
                        hud_state = dict(latest_state)
                        hud_state["possession_percent"] = analytics_state[
                            "possession_percent"
                        ]
                        hud_state["teams"] = [
                            {
                                **t,
                                "passes": analytics.passes_completed.get(
                                    t["team_id"], 0
                                ),
                                "losses": analytics.turnovers.get(t["team_id"], 0),
                            }
                            for t in latest_state.get("teams", [])
                        ]
                        hud_state["carrier"] = None
                        hud_state["status"] = (
                            "holding"
                            if analytics_state.get("carrier")
                            else "in_transit"
                        )
                    draw_possession_hud(frame, hud_state, top_offset=header_h)

                    teams_state = {
                        t["team_id"]: t for t in (latest_state or {}).get("teams", [])
                    }
                    if analytics is not None:
                        strip_h = max(26, int(height * 0.05))
                        draw_scoreboard(
                            frame, analytics_state, teams_state, header_h + strip_h
                        )
                        draw_minimap(
                            frame,
                            analytics_state,
                            mapper.pitch_length,
                            mapper.pitch_width,
                            teams_state,
                        )

                    if banner_event is not None:
                        elapsed = frame_idx - banner_start_frame
                        if elapsed < banner_frames:
                            if banner_is_analytics:
                                draw_event_banner(
                                    frame, banner_event, elapsed / banner_frames
                                )
                            else:
                                draw_possession_banner(
                                    frame, banner_event, elapsed / banner_frames
                                )
                        else:
                            banner_event = None

                if encoder is None:
                    encoder = StreamingChunkEncoder(
                        chunk_output_file, fps, out_w, out_h
                    )
                encoder.write(frame)
                frame_idx += 1
                frames_in_this_chunk += 1

            if encoder is None:
                break

            success = encoder.close()
            chunk_end_sec = frame_idx / fps

            match_stats = None
            if analytics is not None:
                analytics.flush()
                match_stats = analytics.summary()
                _write_json(output_dir / "match_stats.json", match_stats)
                _write_json(output_dir / "events.json", analytics.events)
                _write_json(output_dir / "heatmaps.json", analytics.heatmaps_payload())

            if success:
                chunk_files.append(chunk_output_file)
                chunk_info = {
                    "chunk_index": chunk_idx,
                    "start_time": round(chunk_start_sec, 2),
                    "end_time": round(chunk_end_sec, 2),
                    "duration": round(chunk_end_sec - chunk_start_sec, 2),
                    "video_url": f"http://127.0.0.1:8000/api/videos/jobs/{job_id}/chunk_{chunk_idx}.mp4",
                    "relative_url": f"/api/videos/jobs/{job_id}/chunk_{chunk_idx}.mp4",
                    "counts": chunk_class_counts,
                    "detections_count": chunk_total_detections,
                    "frames": encoder.frames,
                    "possession": chunk_possession(tracker, chunk_event_start),
                }
                if analytics is not None:
                    chunk_info["match_events"] = [
                        e
                        for e in analytics.events
                        if int(str(e["id"]).split("-")[-1]) > chunk_match_event_start
                    ]
                possession_summary = tracker.get_summary()

                with JOBS_LOCK:
                    if job_id in JOBS:
                        JOBS[job_id]["possession_summary"] = possession_summary
                        if match_stats is not None:
                            JOBS[job_id]["match_stats"] = match_stats
                        JOBS[job_id]["chunks"].append(chunk_info)
                        JOBS[job_id]["completed_chunks"] = len(JOBS[job_id]["chunks"])
                        JOBS[job_id]["progress_percent"] = round(
                            (JOBS[job_id]["completed_chunks"] / max(1, total_chunks))
                            * 100,
                            1,
                        )
                        JOBS[job_id]["current_chunk_processing"] = chunk_idx + 1

                logger.info(
                    f"Job {job_id}: Chunk {chunk_idx + 1}/{total_chunks} "
                    f"[{chunk_start_sec:.1f}s - {chunk_end_sec:.1f}s] ready for immediate playback!"
                )

            chunk_idx += 1

        cap.release()

        # Concatenate all chunks into full annotated video
        full_video_file = output_dir / "full_annotated.mp4"
        if chunk_files:
            if len(chunk_files) == 1:
                shutil.copy(chunk_files[0], full_video_file)
                concat_ok = True
            else:
                concat_ok = concatenate_chunks_ffmpeg(chunk_files, full_video_file)

            if not concat_ok and chunk_files[0].exists():
                shutil.copy(chunk_files[0], full_video_file)

        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id]["status"] = "completed"
                JOBS[job_id]["progress_percent"] = 100.0
                JOBS[job_id]["full_video_url"] = (
                    f"http://127.0.0.1:8000/api/videos/jobs/{job_id}/full_annotated.mp4"
                )
                JOBS[job_id]["full_relative_url"] = (
                    f"/api/videos/jobs/{job_id}/full_annotated.mp4"
                )

        logger.info(f"Job {job_id} completely finished with {len(chunk_files)} chunks!")

    except Exception as e:
        logger.exception(f"Job {job_id} failed")
        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id]["status"] = "failed"
                JOBS[job_id]["error"] = str(e)
    finally:
        if analytics is not None:
            analytics.close()


def create_annotation_job(
    video_source_path: Path,
    uploads_dir: Path,
    chunk_duration_sec: float = 5.0,
    confidence_threshold: float = 0.25,
    class_confidences: dict[str, float] | None = None,
    burn_boxes: bool = True,
    parse_detections_fn: Any = None,
    model_obj: Any = None,
    infer_fps: float = 15.0,
    detect_fn: Any = None,
    pitch_mapper: Any = None,
    max_duration_sec: float | None = None,
) -> dict[str, Any]:
    """Initializes and launches a background chunked video annotation job."""
    job_id = f"job_{uuid.uuid4().hex[:10]}"
    output_dir = uploads_dir / "jobs" / job_id
    output_dir.mkdir(parents=True, exist_ok=True)

    class_confs = class_confidences or {
        "football goal": 0.35,
        "football": 0.30,
        "player": 0.25,
        "player with ball": 0.25,
    }

    job_data: dict[str, Any] = {
        "job_id": job_id,
        "status": "processing",
        "progress_percent": 0.0,
        "total_chunks": 1,
        "completed_chunks": 0,
        "current_chunk_processing": 1,
        "duration_sec": 0.0,
        "chunk_duration_sec": chunk_duration_sec,
        "confidence_threshold": confidence_threshold,
        "class_confidences": class_confs,
        "infer_fps": infer_fps,
        "infer_interval_frames": None,
        "possession_summary": None,
        "calibrated": pitch_mapper is not None,
        "match_stats": None,
        "logs": None,
        "chunks": [],
        "full_video_url": None,
        "full_relative_url": None,
        "error": None,
        "created_at": time.time(),
    }

    with JOBS_LOCK:
        JOBS[job_id] = job_data

    thread = threading.Thread(
        target=run_chunked_annotation_worker,
        kwargs={
            "job_id": job_id,
            "video_source_path": video_source_path,
            "output_dir": output_dir,
            "chunk_duration_sec": chunk_duration_sec,
            "confidence_threshold": confidence_threshold,
            "class_confidences": class_confs,
            "burn_boxes": burn_boxes,
            "parse_detections_fn": parse_detections_fn,
            "model_obj": model_obj,
            "infer_fps": infer_fps,
            "detect_fn": detect_fn,
            "pitch_mapper": pitch_mapper,
            "max_duration_sec": max_duration_sec,
        },
        daemon=True,
    )
    thread.start()

    return job_data


def get_job_status(job_id: str) -> dict[str, Any] | None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return None
        return dict(job)


def list_all_jobs() -> list[dict[str, Any]]:
    with JOBS_LOCK:
        return [dict(j) for j in JOBS.values()]
