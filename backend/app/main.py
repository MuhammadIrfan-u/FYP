import base64
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from ultralytics import YOLO

# Optimize PyTorch CPU threads for realtime execution
torch.set_num_threads(4)

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = BASE_DIR / "assets"
MODEL_PATH = ASSETS_DIR / "best_5.pt"
ONNX_PATH = ASSETS_DIR / "best_5.onnx"
UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="FootballCoach PRO - YOLO Analytics Engine",
    version="1.0.0",
    description="Real-time tactical football video analysis using trained YOLO model best_5.pt",
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

# Load YOLO model (prefer optimized ONNX Runtime model if available, fallback to PyTorch .pt)
target_model_path = ONNX_PATH if ONNX_PATH.exists() else MODEL_PATH
print(f"Loading YOLO model from: {target_model_path}")
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
    MODEL_CLASSES = {
        0: "football",
        1: "football goal",
        2: "player",
        3: "player with ball",
    }


class FrameAnalysisRequest(BaseModel):
    image: str  # Base64 data URL or raw base64
    confidence_threshold: float | None = 0.25


def parse_detections(results, conf_threshold: float = 0.25) -> dict[str, Any]:
    detections = []
    class_counts = {
        "player": 0,
        "football": 0,
        "football goal": 0,
        "player with ball": 0,
    }

    if not results or len(results) == 0:
        return {"detections": detections, "class_counts": class_counts}

    result = results[0]
    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return {"detections": detections, "class_counts": class_counts}

    for idx, box in enumerate(boxes):
        conf = float(box.conf[0])
        if conf < conf_threshold:
            continue

        cls_id = int(box.cls[0])
        cls_name = (
            model.names.get(cls_id, f"class_{cls_id}") if model else f"class_{cls_id}"
        )

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
        "model_file": "best_5.pt",
        "classes": MODEL_CLASSES,
        "default_confidence": 0.25,
    }


@app.post("/api/analyze-frame")
async def analyze_frame(raw_request: Request):
    """
    Analyzes a video frame image using the trained YOLO model best_5.pt.
    Seamlessly parses JSON payload { image: base64, confidence_threshold: 0.25 }
    or multipart/form-data.
    """
    if not MODEL_LOADED or model is None:
        raise HTTPException(status_code=500, detail="YOLO model is not initialized.")

    start_time = time.time()
    img_bgr = None
    confidence_threshold = 0.25

    content_type = raw_request.headers.get("content-type", "").lower()

    if "application/json" in content_type:
        try:
            body = await raw_request.json()
            b64_data = body.get("image", "")
            if body.get("confidence_threshold") is not None:
                confidence_threshold = float(body.get("confidence_threshold"))

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

    # Run YOLO inference with optimized input resolution (imgsz=480 for realtime speed)
    results = model(img_bgr, imgsz=480, conf=confidence_threshold, verbose=False)
    parsed = parse_detections(results, conf_threshold=confidence_threshold)
    elapsed_ms = round((time.time() - start_time) * 1000, 1)

    return {
        "success": True,
        "detections": parsed["detections"],
        "class_counts": parsed["class_counts"],
        "total_detections": len(parsed["detections"]),
        "inference_time_ms": elapsed_ms,
    }


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

        # Get video metadata with OpenCV
        cap = cv2.VideoCapture(str(destination))
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
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Video upload failed: {e!s}")


@app.post("/api/analyze-video")
def analyze_video(
    file: UploadFile | None = File(None),  # noqa: B008
    video_filename: str | None = Form(None),
    sample_fps: float = Form(2.0),
    confidence_threshold: float = Form(0.25),
):
    """Analyze a football video file by sampling frames at specified rate (default: 2 frames per sec)"""
    if not MODEL_LOADED or model is None:
        raise HTTPException(status_code=500, detail="YOLO model is not initialized.")

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

    # Calculate step in frames
    step_frames = max(1, round(video_fps / sample_fps))

    timeline = {}
    aggregated_counts = {
        "player": 0,
        "football": 0,
        "football goal": 0,
        "player with ball": 0,
    }
    max_counts = {"player": 0, "football": 0, "football goal": 0, "player with ball": 0}
    frames_analyzed = 0
    curr_frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if curr_frame_idx % step_frames == 0:
            timestamp = round(curr_frame_idx / video_fps, 2)
            results = model(frame, imgsz=480, conf=confidence_threshold, verbose=False)
            parsed = parse_detections(results, conf_threshold=confidence_threshold)

            timeline[f"{timestamp:.2f}"] = {
                "timestamp": timestamp,
                "detections": parsed["detections"],
                "counts": parsed["class_counts"],
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
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
