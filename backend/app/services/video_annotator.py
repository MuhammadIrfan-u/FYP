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
) -> None:
    """Draws a sleek tactical status bar at the top of the video frame."""
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

    # Label text: e.g. "football goal 38%"
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
    cv2.rectangle(frame, (x1, badge_y1), (badge_x2, badge_y2), color, 1, cv2.LINE_AA)

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
) -> None:
    """Worker function executing in a background thread to annotate 5s chunks progressively."""
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
            # Sample inference ~3 times per second so 5s chunks complete rapidly (~12s) without boring viewers
            infer_interval = max(1, round(fps / 3.0))
            latest_parsed = {"detections": [], "class_counts": {}}

            while frames_in_this_chunk < chunk_frames_target:
                ret, frame = cap.read()
                if not ret:
                    break

                # YOLO model inference on sampled intervals
                if (frames_in_this_chunk % infer_interval == 0) and (
                    model_obj is not None
                ):
                    try:
                        results = model_obj(frame, imgsz=480, verbose=False)
                        latest_parsed = parse_detections_fn(
                            results,
                            conf_threshold=confidence_threshold,
                            class_confidences=class_confidences,
                        )
                    except Exception as model_err:  # noqa: BLE001
                        logger.warning(f"Model inference exception: {model_err}")
                        latest_parsed = {"detections": [], "class_counts": {}}

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

                    draw_hud_header(
                        frame,
                        chunk_idx=chunk_idx,
                        total_chunks=total_chunks,
                        start_sec=chunk_start_sec,
                        end_sec=chunk_start_sec + (frames_in_this_chunk / fps),
                        counts=counts,
                    )

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
                }

                with JOBS_LOCK:
                    if job_id in JOBS:
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
