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
) -> None:
    """Worker function executing in a background thread to annotate 5s chunks progressively.

    Inference runs every ``round(fps / infer_fps)`` frames (e.g. 15 fps -> 2-frame stride
    on 30 fps video) so fast passes and turnovers are caught by the possession tracker.
    """
    logger.info(f"Starting chunked annotation job {job_id} for {video_source_path}")

    try:
        cap = cv2.VideoCapture(str(video_source_path))
        if not cap.isOpened():
            raise RuntimeError(f"Could not open input video: {video_source_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)
        duration_sec = total_frames / fps if fps > 0 else 0.0

        chunk_frames_target = max(1, round(fps * chunk_duration_sec))
        total_chunks = (
            max(1, math.ceil(total_frames / chunk_frames_target))
            if total_frames > 0
            else 1
        )

        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id]["total_chunks"] = total_chunks
                JOBS[job_id]["duration_sec"] = round(duration_sec, 2)
                JOBS[job_id]["fps"] = round(fps, 1)
                JOBS[job_id]["resolution"] = f"{width}x{height}"

        output_dir.mkdir(parents=True, exist_ok=True)
        chunk_files: list[Path] = []
        frame_idx = 0
        chunk_idx = 0

        effective_infer_fps = max(0.5, min(float(infer_fps or 15.0), fps))
        infer_interval = max(1, round(fps / effective_infer_fps))
        min_conf = min([confidence_threshold, *class_confidences.values()])
        tracker = TeamPossessionTracker()
        latest_state: dict[str, Any] | None = None
        banner_event: dict[str, Any] | None = None
        banner_start_frame = 0
        banner_frames = max(1, round(fps * BANNER_DURATION_SEC))

        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id]["infer_fps"] = round(effective_infer_fps, 2)
                JOBS[job_id]["infer_interval_frames"] = infer_interval

        while True:
            current_chunk_frames: list[np.ndarray] = []
            chunk_class_counts: dict[str, int] = {
                "player": 0,
                "football": 0,
                "football goal": 0,
                "player with ball": 0,
            }
            chunk_total_detections = 0
            chunk_start_sec = frame_idx / fps

            # Read frames for this chunk
            frames_in_this_chunk = 0
            latest_parsed = {"detections": [], "class_counts": {}}
            chunk_event_start = tracker.event_counter

            while frames_in_this_chunk < chunk_frames_target:
                ret, frame = cap.read()
                if not ret:
                    break

                # YOLO model inference on sampled intervals
                if (frames_in_this_chunk % infer_interval == 0) and (
                    model_obj is not None
                ):
                    try:
                        results = model_obj(
                            frame, imgsz=480, conf=min_conf, verbose=False
                        )
                        latest_parsed = parse_detections_fn(
                            results,
                            conf_threshold=confidence_threshold,
                            class_confidences=class_confidences,
                        )
                    except Exception as model_err:  # noqa: BLE001
                        logger.warning(f"Model inference exception: {model_err}")
                        latest_parsed = {"detections": [], "class_counts": {}}

                    try:
                        latest_state = tracker.process_frame(
                            frame,
                            latest_parsed.get("detections", []),
                            timestamp=round(frame_idx / fps, 3),
                        )
                        if latest_state.get("event"):
                            banner_event = latest_state["event"]
                            banner_start_frame = frame_idx
                    except Exception as track_err:  # noqa: BLE001
                        logger.warning(f"Possession tracking exception: {track_err}")

                    counts = latest_parsed.get("class_counts", {})
                    for k, v in counts.items():
                        chunk_class_counts[k] = chunk_class_counts.get(k, 0) + v
                    chunk_total_detections += len(latest_parsed.get("detections", []))

                detections = latest_parsed.get("detections", [])
                counts = latest_parsed.get("class_counts", {})

                # Draw annotations onto the frame
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
                    draw_possession_hud(frame, latest_state, top_offset=header_h)

                    if banner_event is not None:
                        elapsed = frame_idx - banner_start_frame
                        if elapsed < banner_frames:
                            draw_possession_banner(
                                frame, banner_event, elapsed / banner_frames
                            )
                        else:
                            banner_event = None

                current_chunk_frames.append(frame)
                frame_idx += 1
                frames_in_this_chunk += 1

            if not current_chunk_frames:
                break

            chunk_end_sec = frame_idx / fps
            chunk_output_file = output_dir / f"chunk_{chunk_idx}.mp4"

            # Encode chunk via FFmpeg
            success = encode_chunk_ffmpeg(
                current_chunk_frames,
                chunk_output_file,
                fps=fps,
                width=width,
                height=height,
            )

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
                    "frames": len(current_chunk_frames),
                    "possession": chunk_possession(tracker, chunk_event_start),
                }
                possession_summary = tracker.get_summary()

                with JOBS_LOCK:
                    if job_id in JOBS:
                        JOBS[job_id]["possession_summary"] = possession_summary
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
