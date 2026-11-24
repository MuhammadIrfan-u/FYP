import base64
import json
import logging
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from ultralytics import YOLO

from app import model_config
from app.services.pitch_homography import (
    DEFAULT_PITCH_LENGTH,
    DEFAULT_PITCH_WIDTH,
    PitchMapper,
    build_mapper_from_landmarks,
    landmark_definitions,
    load_calibration,
    save_calibration,
)
from app.services.team_possession import (
    TeamPossessionTracker,
    get_or_create_session_tracker,
    reset_session_tracker,
)
from app.services.tiled_inference import WIDE_ASPECT, detect_frame
from app.services.video_annotator import (
    create_annotation_job,
    get_job_status,
    list_all_jobs,
)
from app.services.video_sync import (
    build_merge_plan,
    create_merge_job,
    get_merge_job,
    render_side_by_side_video,
    synchronize_two_videos,
)

logger = logging.getLogger("api_main")

# Optimize PyTorch CPU threads for realtime execution
torch.set_num_threads(4)

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = BASE_DIR / "assets"
MODEL_PATH = ASSETS_DIR / model_config.MODEL_FILENAMES[0]
INFER_IMGSZ = model_config.INFER_IMGSZ
UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
SYNC_DIR = UPLOADS_DIR / "sync_sessions"
SYNC_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="FootballCoach PRO - YOLO Analytics Engine",
    version="1.0.0",
    description="Real-time tactical football video analysis using a trained YOLO detection model",
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded videos
app.mount("/api/videos", StaticFiles(directory=str(UPLOADS_DIR)), name="videos")

# Load the detection model: the first candidate present on disk wins, so the
# older best_5 weights still work if the current model is missing.
target_model_path = next(
    (p for p in (ASSETS_DIR / n for n in model_config.MODEL_FILENAMES) if p.exists()),
    MODEL_PATH,
)
print(f"Loading YOLO model from: {target_model_path} (imgsz {INFER_IMGSZ})")
try:
    if not target_model_path.exists():
        raise FileNotFoundError(f"Model file not found at {target_model_path}")
    if target_model_path.suffix == ".onnx":
        model = YOLO(str(target_model_path), task="detect")
    else:
        model = YOLO(str(target_model_path))
    MODEL_LOADED = True
    MODEL_CLASSES = model.names
    print(f"Model successfully loaded! Detected classes: {MODEL_CLASSES}")
except Exception as e:  # noqa: BLE001
    print(f"Failed to load YOLO model: {e}")
    model = None
    MODEL_LOADED = False
    MODEL_CLASSES = dict(model_config.FALLBACK_CLASS_NAMES)


class FrameAnalysisRequest(BaseModel):
    image: str  # Base64 data URL or raw base64
    confidence_threshold: float | None = 0.25
    class_confidences: dict[str, float] | None = None
    session_id: str | None = None
    timestamp: float | None = None
    reset_session: bool | None = False


class PossessionResetRequest(BaseModel):
    session_id: str


def _parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _parse_optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_detections(
    results,
    conf_threshold: float = 0.25,
    class_confidences: dict[str, float] | None = None,
) -> dict[str, Any]:
    detections = []
    class_counts = model_config.empty_class_counts()

    if not results or len(results) == 0:
        return {"detections": detections, "class_counts": class_counts}

    result = results[0]
    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return {"detections": detections, "class_counts": class_counts}

    for idx, box in enumerate(boxes):
        conf = float(box.conf[0])
        cls_id = int(box.cls[0])
        cls_name = (
            model.names.get(cls_id, f"class_{cls_id}") if model else f"class_{cls_id}"
        )

        # Apply per-class confidence threshold (e.g. football goal 35%), discarding below threshold
        effective_threshold = conf_threshold
        if class_confidences:
            for k, v in class_confidences.items():
                if k.lower().strip() == cls_name.lower().strip() or str(k) == str(
                    cls_id
                ):
                    effective_threshold = float(v)
                    break

        if conf < effective_threshold:
            continue

        # Count classes
        if cls_name in class_counts:
            class_counts[cls_name] += 1
        else:
            class_counts[cls_name] = 1

        # Normalized coordinates: [cx, cy, w, h] (0 to 1)
        xywhn = box.xywhn[0].tolist()
        cx, cy, w, h = xywhn[0], xywhn[1], xywhn[2], xywhn[3]

        # Convert to percentage [left_pct, top_pct, width_pct, height_pct]
        x_pct = max(0.0, min(100.0, (cx - (w / 2.0)) * 100.0))
        y_pct = max(0.0, min(100.0, (cy - (h / 2.0)) * 100.0))
        w_pct = max(0.0, min(100.0, w * 100.0))
        h_pct = max(0.0, min(100.0, h * 100.0))

        detections.append(
            {
                "id": f"det-{idx}-{int(time.time() * 1000) % 100000}",
                "class": cls_name,
                "label": cls_name.capitalize(),
                "confidence": round(conf, 3),
                "x": round(x_pct, 2),
                "y": round(y_pct, 2),
                "w": round(w_pct, 2),
                "h": round(h_pct, 2),
            }
        )

    return {"detections": detections, "class_counts": class_counts}


@app.get("/")
def root():
    return {
        "message": "FootballCoach PRO YOLO Analytics API is active",
        "model_loaded": MODEL_LOADED,
        "classes": MODEL_CLASSES,
    }


@app.get("/api/model-info")
def get_model_info():
    return {
        "status": "ready" if MODEL_LOADED else "error",
        "model_file": target_model_path.name if target_model_path else "unknown",
        "format": "onnx"
        if target_model_path and target_model_path.suffix == ".onnx"
        else "pytorch",
        "classes": MODEL_CLASSES,
        "default_confidence": 0.25,
    }


@app.post("/api/analyze-frame")
async def analyze_frame(raw_request: Request):
    """
    Analyzes a video frame image using the trained YOLO detection model.
    Seamlessly parses JSON payload { image: base64, confidence_threshold: 0.25 }
    or multipart/form-data.
    """
    if not MODEL_LOADED or model is None:
        raise HTTPException(status_code=500, detail="YOLO model is not initialized.")

    start_time = time.time()
    img_bgr = None
    confidence_threshold = 0.25
    class_confidences = None
    session_id: str | None = None
    frame_timestamp: float | None = None
    reset_session = False

    content_type = raw_request.headers.get("content-type", "").lower()

    if "application/json" in content_type:
        try:
            body = await raw_request.json()
            b64_data = body.get("image", "")
            if body.get("confidence_threshold") is not None:
                confidence_threshold = float(body.get("confidence_threshold"))
            if body.get("class_confidences"):
                class_confidences = body.get("class_confidences")
            session_id = body.get("session_id") or None
            frame_timestamp = _parse_optional_float(body.get("timestamp"))
            reset_session = _parse_bool(body.get("reset_session"))

            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]
            img_bytes = base64.b64decode(b64_data)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(
                status_code=400, detail=f"Failed to decode base64 JSON frame: {e!s}"
            )

    elif "multipart/form-data" in content_type:
        try:
            form = await raw_request.form()
            file_field = form.get("file")
            conf_field = form.get("confidence_threshold")
            if conf_field:
                confidence_threshold = float(conf_field)
            session_id = form.get("session_id") or None
            frame_timestamp = _parse_optional_float(form.get("timestamp"))
            reset_session = _parse_bool(form.get("reset_session"))
            cls_conf_field = form.get("class_confidences")
            if cls_conf_field:
                try:
                    class_confidences = (
                        json.loads(cls_conf_field)
                        if isinstance(cls_conf_field, str)
                        else cls_conf_field
                    )
                except (json.JSONDecodeError, ValueError, TypeError):
                    class_confidences = None

            if file_field and hasattr(file_field, "read"):
                contents = await file_field.read()
                nparr = np.frombuffer(contents, np.uint8)
                img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(
                status_code=400, detail=f"Failed to decode multipart file: {e!s}"
            )

    else:
        # Fallback: attempt JSON decoding
        try:
            body = await raw_request.json()
            b64_data = body.get("image", "")
            if body.get("confidence_threshold") is not None:
                confidence_threshold = float(body.get("confidence_threshold"))
            if body.get("class_confidences"):
                class_confidences = body.get("class_confidences")
            session_id = body.get("session_id") or None
            frame_timestamp = _parse_optional_float(body.get("timestamp"))
            reset_session = _parse_bool(body.get("reset_session"))

            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]
            img_bytes = base64.b64decode(b64_data)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(
                status_code=400, detail=f"Invalid payload format: {e!s}"
            )

    if img_bgr is None or img_bgr.size == 0:
        raise HTTPException(
            status_code=400, detail="Invalid or empty image decoded from frame."
        )

    # Compute minimal detection threshold to avoid pre-filtering classes with lower thresholds
    min_conf = confidence_threshold
    if class_confidences and isinstance(class_confidences, dict):
        try:
            min_conf = min(
                confidence_threshold, *[float(v) for v in class_confidences.values()]
            )
        except (ValueError, TypeError):
            min_conf = confidence_threshold

    # Run YOLO inference with optimized input resolution (imgsz=INFER_IMGSZ for realtime speed)
    results = model(img_bgr, imgsz=INFER_IMGSZ, conf=min_conf, verbose=False)
    parsed = parse_detections(
        results,
        conf_threshold=confidence_threshold,
        class_confidences=class_confidences,
    )

    # Team clustering + possession. Without a session_id, a throwaway tracker still
    # labels teams for this single frame.
    if session_id:
        tracker = get_or_create_session_tracker(str(session_id), reset=reset_session)
    else:
        tracker = TeamPossessionTracker()
    possession = tracker.process_frame(
        img_bgr, parsed["detections"], timestamp=frame_timestamp
    )
    elapsed_ms = round((time.time() - start_time) * 1000, 1)

    return {
        "success": True,
        "detections": parsed["detections"],
        "class_counts": parsed["class_counts"],
        "total_detections": len(parsed["detections"]),
        "inference_time_ms": elapsed_ms,
        "session_id": session_id,
        "possession": possession,
    }


@app.post("/api/possession/reset")
def reset_possession_session(req: PossessionResetRequest):
    """Clear team clusters, tracks and possession counters for a live session."""
    existed = reset_session_tracker(req.session_id)
    if not existed:
        # Create a fresh tracker so the next frame starts clean either way.
        get_or_create_session_tracker(req.session_id, reset=True)
    return {"success": True, "session_id": req.session_id, "existed": existed}


@app.post("/api/upload")
def upload_video(file: UploadFile = File(...)):  # noqa: B008
    """Upload a football video and return access URL and metadata"""
    try:
        file_ext = Path(file.filename).suffix.lower() or ".mp4"
        clean_stem = Path(file.filename).stem.replace(" ", "_")
        unique_name = f"{clean_stem}_{uuid.uuid4().hex[:8]}{file_ext}"
        destination = UPLOADS_DIR / unique_name

        with open(destination, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Get video metadata with OpenCV; reject files that cannot be decoded
        # (e.g. truncated MP4s without a moov atom) instead of failing later.
        cap = cv2.VideoCapture(str(destination))
        readable = cap.isOpened() and cap.read()[0]
        if not readable:
            cap.release()
            destination.unlink(missing_ok=True)
            raise HTTPException(
                status_code=422,
                detail=(
                    "The uploaded file is not a playable video (it may be incomplete or "
                    "truncated, e.g. 'moov atom not found'). Re-export or re-cut it and "
                    "upload again."
                ),
            )
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        duration_sec = round(frame_count / fps, 2) if fps > 0 else 0.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)
        cap.release()

        return {
            "success": True,
            "filename": file.filename,
            "saved_name": unique_name,
            "video_url": f"http://127.0.0.1:8000/api/videos/{unique_name}",
            "relative_url": f"/api/videos/{unique_name}",
            "duration": duration_sec,
            "fps": round(fps, 1),
            "resolution": f"{width}x{height}",
            "size_bytes": destination.stat().st_size,
        }
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Video upload failed: {e!s}")


@app.post("/api/analyze-video")
def analyze_video(
    file: UploadFile | None = File(None),  # noqa: B008
    video_filename: str | None = Form(None),
    sample_fps: float = Form(10.0),
    confidence_threshold: float = Form(0.25),
    class_confidences: str | None = Form(None),
):
    """Analyze a football video by sampling frames (default 10 fps) with per-class thresholds.

    Each timeline entry carries the per-frame team/possession state, and the response
    includes an overall ``possession_summary``.
    """
    if not MODEL_LOADED or model is None:
        raise HTTPException(status_code=500, detail="YOLO model is not initialized.")

    parsed_class_confidences = None
    if class_confidences:
        try:
            parsed_class_confidences = (
                json.loads(class_confidences)
                if isinstance(class_confidences, str)
                else class_confidences
            )
        except (json.JSONDecodeError, ValueError, TypeError):
            parsed_class_confidences = None

    # Determine video file path
    video_path = None
    if file:
        file_ext = Path(file.filename).suffix.lower() or ".mp4"
        unique_name = f"analyze_{uuid.uuid4().hex[:8]}{file_ext}"
        video_path = UPLOADS_DIR / unique_name
        with open(video_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    elif video_filename:
        video_path = UPLOADS_DIR / video_filename
        if not video_path.exists():
            raise HTTPException(
                status_code=404, detail="Specified video file not found."
            )
    else:
        raise HTTPException(
            status_code=400, detail="Provide either a video file or video_filename."
        )

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="Failed to open video file.")

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_sec = total_frames / video_fps if video_fps > 0 else 0.0

    # Calculate step in frames (dense sampling so passes/turnovers are not skipped)
    sample_fps = max(0.1, float(sample_fps or 10.0))
    step_frames = max(1, round(video_fps / sample_fps))
    possession_tracker = TeamPossessionTracker()

    timeline = {}
    aggregated_counts = model_config.empty_class_counts()
    max_counts = model_config.empty_class_counts()
    frames_analyzed = 0
    curr_frame_idx = 0

    min_conf = confidence_threshold
    if parsed_class_confidences and isinstance(parsed_class_confidences, dict):
        try:
            min_conf = min(
                confidence_threshold,
                *[float(v) for v in parsed_class_confidences.values()],
            )
        except (ValueError, TypeError):
            min_conf = confidence_threshold

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if curr_frame_idx % step_frames == 0:
            timestamp = round(curr_frame_idx / video_fps, 2)
            results = model(frame, imgsz=INFER_IMGSZ, conf=min_conf, verbose=False)
            parsed = parse_detections(
                results,
                conf_threshold=confidence_threshold,
                class_confidences=parsed_class_confidences,
            )

            frame_possession = possession_tracker.process_frame(
                frame, parsed["detections"], timestamp=timestamp
            )

            timeline[f"{timestamp:.2f}"] = {
                "timestamp": timestamp,
                "detections": parsed["detections"],
                "counts": parsed["class_counts"],
                "possession": frame_possession,
            }

            for k, v in parsed["class_counts"].items():
                if k in aggregated_counts:
                    aggregated_counts[k] += v
                    max_counts[k] = max(max_counts[k], v)

            frames_analyzed += 1

        curr_frame_idx += 1

    cap.release()

    # Average counts per analyzed frame
    avg_counts = {}
    for k, v in aggregated_counts.items():
        avg_counts[k] = round(v / max(1, frames_analyzed), 1)

    return {
        "success": True,
        "filename": video_path.name,
        "video_url": f"http://127.0.0.1:8000/api/videos/{video_path.name}",
        "duration": round(duration_sec, 2),
        "total_frames": total_frames,
        "frames_analyzed": frames_analyzed,
        "timeline": timeline,
        "peak_class_counts": max_counts,
        "avg_class_counts": avg_counts,
        "sample_fps": sample_fps,
        "frame_step": step_frames,
        "possession_summary": possession_tracker.get_summary(),
    }


# ---------------------------------------------------------------------------
# Pitch calibration (drag-and-drop landmarks -> homography view)
# ---------------------------------------------------------------------------


def calibrations_dir() -> Path:
    return UPLOADS_DIR / "calibrations"


def _resolve_local_video(video_filename: str) -> Path | None:
    name = Path(video_filename).name  # no path traversal
    for c in (
        UPLOADS_DIR / name,
        ASSETS_DIR / name,
        BASE_DIR.parent / name,
        BASE_DIR.parent / "frontend" / "public" / name,
    ):
        if c.exists() and c.is_file():
            return c
    return None


class LandmarkPoint(BaseModel):
    id: str
    x: float  # image pixels in the calibration frame
    y: float
    pitch_x: float | None = None  # optional custom landmark (metres)
    pitch_y: float | None = None


class HomographyRequest(BaseModel):
    video_filename: str
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    pitch_length: float = Field(DEFAULT_PITCH_LENGTH, gt=20, le=130)
    pitch_width: float = Field(DEFAULT_PITCH_WIDTH, gt=15, le=100)
    points: list[LandmarkPoint]
    save: bool = True


def _calibration_response(mapper: PitchMapper, saved: bool) -> dict[str, Any]:
    quality = mapper.quality()
    warnings = []
    if quality["points"] < 6:
        warnings.append(
            "Only 4-5 landmarks: a plain homography is used. Add 6+ spread-out "
            "landmarks so lens/panorama curvature can be corrected."
        )
    if quality["loo_rmse_m"] is not None and quality["loo_rmse_m"] > 3.0:
        warnings.append(
            f"Landmark consistency is low (leave-one-out error {quality['loo_rmse_m']} m). "
            "Check that each landmark sits on the right pitch marking."
        )
    return {
        "success": True,
        "saved": saved,
        "calibration": mapper.to_dict(),
        "quality": quality,
        "overlay_lines": mapper.overlay_lines_pct(),
        "warnings": warnings,
    }


@app.get("/api/pitch/landmarks")
def get_pitch_landmarks(
    length: float = DEFAULT_PITCH_LENGTH, width: float = DEFAULT_PITCH_WIDTH
):
    """Named pitch landmarks (metres) the user can drag onto the frame."""
    return {
        "pitch_length": length,
        "pitch_width": width,
        "landmarks": landmark_definitions(length, width),
        "min_points": 4,
        "recommended_points": 8,
    }


@app.get("/api/video-frame")
def get_video_frame(video_filename: str, t: float = 1.0, max_width: int = 4096):
    """JPEG frame of an uploaded video, used as the calibration canvas."""
    path = _resolve_local_video(video_filename)
    if path is None:
        raise HTTPException(status_code=404, detail="Video not found.")
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Failed to open video file.")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        frame_no = max(0, round(max(0.0, t) * fps))
        if total > 0:
            frame_no = min(frame_no, total - 1)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
        ok, frame = cap.read()
        if not ok or frame is None:
            raise HTTPException(status_code=400, detail="Could not read frame.")
    finally:
        cap.release()
    h, w = frame.shape[:2]
    if w > max_width > 0:
        frame = cv2.resize(frame, (max_width, round(h * max_width / w)))
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise HTTPException(status_code=500, detail="Could not encode frame.")
    return Response(
        content=buf.tobytes(),
        media_type="image/jpeg",
        headers={
            "X-Video-Width": str(w),
            "X-Video-Height": str(h),
            "Cache-Control": "no-store",
        },
    )


@app.post("/api/homography")
def compute_homography(req: HomographyRequest):
    """Fit (and save) the image -> pitch mapping from the placed landmarks."""
    try:
        mapper = build_mapper_from_landmarks(
            [p.model_dump(exclude_none=True) for p in req.points],
            req.image_width,
            req.image_height,
            req.pitch_length,
            req.pitch_width,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if req.save:
        save_calibration(calibrations_dir(), req.video_filename, mapper)
    return _calibration_response(mapper, saved=req.save)


@app.get("/api/homography")
def get_homography(video_filename: str):
    mapper = load_calibration(calibrations_dir(), video_filename)
    if mapper is None:
        raise HTTPException(status_code=404, detail="No calibration for this video.")
    return _calibration_response(mapper, saved=True)


def _make_detect_fn(confidence_threshold: float, class_confidences: dict[str, float]):
    """Tiled inference for wide (full-field panorama) frames, classic path otherwise."""
    min_conf = min([confidence_threshold, *class_confidences.values()])

    def detect(frame: np.ndarray) -> dict[str, Any]:
        h, w = frame.shape[:2]
        if h > 0 and w / h > WIDE_ASPECT:
            return detect_frame(
                model, frame, confidence_threshold, class_confidences, imgsz=INFER_IMGSZ
            )
        results = model(frame, imgsz=INFER_IMGSZ, conf=min_conf, verbose=False)
        return parse_detections(
            results,
            conf_threshold=confidence_threshold,
            class_confidences=class_confidences,
        )

    return detect


@app.post("/api/background-annotate")
def start_background_annotation(
    file: UploadFile | None = File(None),  # noqa: B008
    video_filename: str | None = Form(None),
    video_url: str | None = Form(None),
    chunk_duration: float = Form(5.0),
    confidence_threshold: float = Form(0.25),
    class_confidences: str | None = Form(None),
    burn_boxes: bool = Form(True),
    infer_fps: float = Form(15.0),
    homography: str | None = Form(None),
    require_calibration: bool = Form(False),
    max_duration: float | None = Form(None),
    passes_only: bool = Form(False),
):
    """
    Launches a background video inference and annotation job that segments big videos
    into 5-second subvideos with per-class confidence thresholds.
    Subvideos are encoded progressively so viewers can start watching chunk 1 immediately.
    """
    if not MODEL_LOADED or model is None:
        raise HTTPException(status_code=500, detail="YOLO model is not initialized.")

    # 1. Parse class confidences (e.g. {"football goal": 0.35, "football": 0.30})
    parsed_class_confidences = dict(model_config.DEFAULT_CLASS_CONFIDENCES)
    if class_confidences:
        try:
            custom_confs = (
                json.loads(class_confidences)
                if isinstance(class_confidences, str)
                else class_confidences
            )
            if isinstance(custom_confs, dict):
                parsed_class_confidences.update(custom_confs)
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logger.warning(f"Could not parse class_confidences: {e}")

    # 2. Resolve source video file path prioritizing uploaded videos
    target_video_path: Path | None = None

    if file and hasattr(file, "read") and getattr(file, "filename", None):
        file_ext = Path(file.filename).suffix.lower() or ".mp4"
        clean_stem = Path(file.filename).stem.replace(" ", "_")
        unique_name = f"bg_{clean_stem}_{uuid.uuid4().hex[:8]}{file_ext}"
        target_video_path = UPLOADS_DIR / unique_name
        with open(target_video_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

    # Check video_url (e.g. http://127.0.0.1:8000/api/videos/video_...)
    if not target_video_path and video_url and "/api/videos/" in video_url:
        fname = video_url.split("/api/videos/")[-1].split("?")[0]
        candidate = UPLOADS_DIR / fname
        if candidate.exists():
            target_video_path = candidate

    # Check video_filename
    if not target_video_path and video_filename:
        candidates = [
            UPLOADS_DIR / video_filename,
            BASE_DIR / "assets" / video_filename,
            BASE_DIR.parent / "frontend" / "public" / video_filename,
        ]
        for c in candidates:
            if c.exists():
                target_video_path = c
                break

        # Fuzzy match filename in UPLOADS_DIR if exact match wasn't found
        if not target_video_path:
            clean_stem = Path(video_filename).stem.lower().replace(" ", "_")
            for f in sorted(
                UPLOADS_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True
            ):
                if not f.name.startswith(("chunk_", "full_", "test_")) and (
                    clean_stem in f.name.lower() or f.name.lower() in clean_stem
                ):
                    target_video_path = f
                    break

    # Remote video (e.g. Supabase storage signed URL) - fetched by the worker.
    remote_url: str | None = None
    if (
        not target_video_path
        and video_url
        and video_url.startswith(("http://", "https://"))
    ):
        if "football_match_demo" in video_url:
            local_demo = (
                BASE_DIR.parent / "frontend" / "public" / "football_match_demo.mp4"
            )
            if local_demo.exists():
                target_video_path = local_demo
        elif not video_url.startswith("http://127.0.0.1") and not video_url.startswith(
            "http://localhost"
        ):
            # Deliberately NOT downloaded here. Pulling tens of megabytes from
            # Supabase inside the request holds the HTTP response open for the
            # whole transfer, and the browser gives up first - which reaches the
            # user as "Failed to fetch", and only for sessions that have no
            # local copy. The worker fetches it, so this endpoint answers at once.
            remote_url = video_url

    # Fallback to most recently uploaded session video in UPLOADS_DIR.
    # Not used when a remote URL was given: analysing an unrelated video is far
    # worse than reporting that the session's own video could not be fetched,
    # because the results look perfectly valid but belong to another match.
    substituted_video = False
    if not target_video_path and not remote_url:
        uploaded_videos = sorted(
            [
                f
                for f in UPLOADS_DIR.glob("*.mp4")
                if not f.name.startswith("chunk_")
                and not f.name.startswith("full_")
                and not f.name.startswith("test_")
            ],
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if uploaded_videos:
            target_video_path = uploaded_videos[0]
            substituted_video = True
            logger.warning(
                f"No match for '{video_filename}'; falling back to the most "
                f"recent upload: {target_video_path.name}"
            )

    if not remote_url and (not target_video_path or not target_video_path.exists()):
        demo_candidate = (
            BASE_DIR.parent / "frontend" / "public" / "football_match_demo.mp4"
        )
        if demo_candidate.exists():
            target_video_path = demo_candidate
        else:
            raise HTTPException(
                status_code=400,
                detail="Provide a valid video file, video_filename, or video_url.",
            )

    # 3. Pitch calibration: explicit payload, else the one saved for this video.
    pitch_mapper: PitchMapper | None = None
    if homography:
        try:
            pitch_mapper = PitchMapper.from_dict(json.loads(homography))
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            raise HTTPException(status_code=422, detail=f"Invalid homography: {e!s}")
    else:
        known_names = (
            target_video_path.name if target_video_path else None,
            video_filename,
        )
        for name in known_names:
            if name:
                pitch_mapper = load_calibration(calibrations_dir(), name)
                if pitch_mapper is not None:
                    break
    if require_calibration and pitch_mapper is None:
        raise HTTPException(
            status_code=409,
            detail="Pitch calibration required: place the field landmarks first.",
        )

    # 4. Create job and start background progressive processing
    job = create_annotation_job(
        video_source_path=target_video_path,
        remote_video_url=remote_url,
        substituted_video=substituted_video,
        uploads_dir=UPLOADS_DIR,
        chunk_duration_sec=chunk_duration,
        confidence_threshold=confidence_threshold,
        class_confidences=parsed_class_confidences,
        burn_boxes=burn_boxes,
        parse_detections_fn=parse_detections,
        model_obj=model,
        infer_fps=infer_fps,
        detect_fn=_make_detect_fn(confidence_threshold, parsed_class_confidences),
        pitch_mapper=pitch_mapper,
        max_duration_sec=max_duration,
        passes_only=passes_only,
    )

    return {
        "success": True,
        "job_id": job["job_id"],
        "status": job["status"],
        "chunk_duration": chunk_duration,
        "class_confidences": job["class_confidences"],
        "infer_fps": job["infer_fps"],
        "calibrated": pitch_mapper is not None,
        "passes_only": passes_only,
        "message": "Background annotation started. 5-second subvideos will stream progressively as they finish.",
    }


@app.get("/api/background-jobs/{job_id}")
def get_background_job_endpoint(job_id: str):
    """Retrieve progressive annotation status and completed 5-second subvideo URLs."""
    job = get_job_status(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    return job


@app.get("/api/background-jobs")
def list_background_jobs_endpoint():
    """List all background annotation jobs."""
    return {"jobs": list_all_jobs()}


class RenderSyncRequest(BaseModel):
    video_a_filename: str
    video_b_filename: str
    offset_seconds: float = 0.0
    start_delay_a: float = 0.0
    start_delay_b: float = 0.0


class MergeSideBySideRequest(BaseModel):
    """Camera 1 (left) + Camera 2 (right) merged into one clap-aligned MP4.

    `trim_start_a` / `trim_start_b` are each feed's sync point (its clap time), so the
    merge starts from the synchronized moment in both feeds and merged 0:00 is the
    same real-world instant on both halves. With `trim_to_overlap` the merge also ends
    when the first feed runs out, so both halves show footage for the whole file.
    """

    video_a_filename: str
    video_b_filename: str
    trim_start_a: float = Field(0.0, ge=0.0)
    trim_start_b: float = Field(0.0, ge=0.0)
    trim_to_overlap: bool = True
    start_delay_a: float = 0.0
    start_delay_b: float = 0.0
    output_height: int | None = Field(1080, ge=120, le=2160)
    title: str | None = None


@app.post("/api/sync-training-videos")
def sync_training_videos_endpoint(
    file_a: UploadFile | None = File(None),  # noqa: B008
    file_b: UploadFile | None = File(None),  # noqa: B008
    video_a_filename: str | None = Form(None),
    video_b_filename: str | None = Form(None),
):
    """Synchronizes two training video feeds (e.g. multi-camera drill setup) by detecting the audio clap sound.

    Computes millisecond-precision offset, audio waveforms, and returns preview URLs for both
    original side-by-side and clap-synchronized playback.
    """
    sync_id = f"sync_{uuid.uuid4().hex[:10]}"
    session_dir = SYNC_DIR / sync_id
    session_dir.mkdir(parents=True, exist_ok=True)

    path_a: Path | None = None
    path_b: Path | None = None

    # Handle Video A
    if file_a and hasattr(file_a, "read") and getattr(file_a, "filename", None):
        ext_a = Path(file_a.filename).suffix.lower() or ".mp4"
        clean_a = Path(file_a.filename).stem.replace(" ", "_")
        path_a = session_dir / f"angle_a_{clean_a}{ext_a}"
        with open(path_a, "wb") as f:
            shutil.copyfileobj(file_a.file, f)
    elif video_a_filename:
        candidates = [
            UPLOADS_DIR / video_a_filename,
            BASE_DIR.parent / "frontend" / "public" / video_a_filename,
            ASSETS_DIR / video_a_filename,
        ]
        for c in candidates:
            if c.exists():
                path_a = c
                break

    # Handle Video B
    if file_b and hasattr(file_b, "read") and getattr(file_b, "filename", None):
        ext_b = Path(file_b.filename).suffix.lower() or ".mp4"
        clean_b = Path(file_b.filename).stem.replace(" ", "_")
        path_b = session_dir / f"angle_b_{clean_b}{ext_b}"
        with open(path_b, "wb") as f:
            shutil.copyfileobj(file_b.file, f)
    elif video_b_filename:
        candidates = [
            UPLOADS_DIR / video_b_filename,
            BASE_DIR.parent / "frontend" / "public" / video_b_filename,
            ASSETS_DIR / video_b_filename,
        ]
        for c in candidates:
            if c.exists():
                path_b = c
                break

    # Default fallbacks if demo requested or missing
    demo_fallback = BASE_DIR.parent / "frontend" / "public" / "football_match_demo.mp4"
    uploaded_mps = [
        f
        for f in sorted(
            UPLOADS_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True
        )
        if not f.name.startswith("chunk_")
        and not f.name.startswith("full_")
        and not f.name.startswith("synced_")
        and not f.name.startswith("merged_")
    ]

    if not path_a:
        path_a = uploaded_mps[0] if uploaded_mps else demo_fallback

    if not path_b:
        path_b = (
            uploaded_mps[1]
            if len(uploaded_mps) > 1
            else (uploaded_mps[0] if uploaded_mps else demo_fallback)
        )

    if not path_a or not path_a.exists() or not path_b or not path_b.exists():
        raise HTTPException(
            status_code=400,
            detail="Could not resolve Video A and Video B for synchronization.",
        )

    # Perform synchronization via audio clap detection and cross-correlation
    sync_result = synchronize_two_videos(path_a, path_b)

    def get_url(p: Path) -> str:
        try:
            rel = p.relative_to(UPLOADS_DIR)
            return f"http://127.0.0.1:8000/api/videos/{rel.as_posix()}"
        except ValueError:
            return f"/api/videos/{p.name}"

    sync_result["sync_id"] = sync_id
    sync_result["video_a"]["video_url"] = get_url(path_a)
    sync_result["video_b"]["video_url"] = get_url(path_b)
    sync_result["video_a"]["filename"] = path_a.name
    sync_result["video_b"]["filename"] = path_b.name

    return sync_result


def _resolve_sync_source(video_filename: str) -> Path | None:
    """Locates a synchronization source video inside the uploads tree."""
    name = Path(video_filename).name  # no path traversal
    direct = UPLOADS_DIR / name
    if direct.exists() and direct.is_file():
        return direct
    for p in UPLOADS_DIR.rglob(name):
        if p.is_file():
            return p
    return _resolve_local_video(name)


@app.post("/api/render-synced-video")
def render_synced_video_endpoint(req: RenderSyncRequest):
    """Renders composite side-by-side synchronized comparison video via FFmpeg."""
    path_a = _resolve_sync_source(req.video_a_filename)
    path_b = _resolve_sync_source(req.video_b_filename)

    if not path_a or not path_b:
        raise HTTPException(
            status_code=404, detail="One or both video sources could not be located."
        )

    render_name = f"synced_{uuid.uuid4().hex[:8]}.mp4"
    output_path = SYNC_DIR / render_name

    ok = render_side_by_side_video(
        path_a,
        path_b,
        offset_seconds=req.offset_seconds,
        output_path=output_path,
        start_delay_a=req.start_delay_a,
        start_delay_b=req.start_delay_b,
    )
    if not ok or not output_path.exists():
        raise HTTPException(
            status_code=500, detail="Failed to render side-by-side synced video."
        )

    rel_url = f"/api/videos/sync_sessions/{render_name}"
    return {
        "success": True,
        "synced_video_url": f"http://127.0.0.1:8000{rel_url}",
        "relative_url": rel_url,
    }


@app.post("/api/merge-side-by-side")
def merge_side_by_side_endpoint(req: MergeSideBySideRequest):
    """Merges two clap-synchronized camera feeds into ONE horizontal side-by-side MP4.

    Camera 1 lands on the left half and Camera 2 on the right half. The merge starts
    at the synchronized moment in both feeds, each pane keeps its own aspect ratio,
    and the merged file is written into the regular uploads folder so it can be used
    as a single input for the detection pipeline (calibration, analysis, annotation).
    """
    path_a = _resolve_sync_source(req.video_a_filename)
    path_b = _resolve_sync_source(req.video_b_filename)

    if not path_a or not path_b:
        raise HTTPException(
            status_code=404,
            detail="One or both camera videos could not be located for merging.",
        )

    plan = build_merge_plan(
        path_a,
        path_b,
        start_delay_a=req.start_delay_a,
        start_delay_b=req.start_delay_b,
        trim_start_a=req.trim_start_a,
        trim_start_b=req.trim_start_b,
        trim_to_overlap=req.trim_to_overlap,
        target_height=req.output_height,
    )
    if plan["master_duration"] <= 0.2:
        raise HTTPException(
            status_code=422,
            detail=(
                "The two feeds do not overlap after the sync point, so there is "
                "nothing to merge. Check the detected clap positions."
            ),
        )

    raw_stem = (req.title or "merged_cameras").strip() or "merged_cameras"
    safe_stem = "".join(
        ch if (ch.isalnum() or ch in "-_") else "_" for ch in raw_stem.replace(" ", "_")
    )[:48]
    merged_name = f"merged_{safe_stem}_{uuid.uuid4().hex[:8]}.mp4"
    output_path = UPLOADS_DIR / merged_name
    rel_url = f"/api/videos/{merged_name}"

    job = create_merge_job(
        path_a,
        path_b,
        output_path=output_path,
        relative_url=rel_url,
        start_delay_a=req.start_delay_a,
        start_delay_b=req.start_delay_b,
        trim_start_a=req.trim_start_a,
        trim_start_b=req.trim_start_b,
        trim_to_overlap=req.trim_to_overlap,
        target_height=req.output_height,
    )
    return {"success": True, **job}


@app.get("/api/merge-jobs/{job_id}")
def get_merge_job_endpoint(job_id: str):
    """Progress of a side-by-side merge job."""
    job = get_merge_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Merge job '{job_id}' not found.")
    return job


if __name__ == "__main__":
    import os

    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    print(f"Starting server on 0.0.0.0:{port}...")
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
