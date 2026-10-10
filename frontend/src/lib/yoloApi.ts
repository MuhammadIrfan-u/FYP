/**
 * YOLO Video Analytics API Client
 * Connects to the local FastAPI YOLO service running at http://127.0.0.1:8000
 */

export const YOLO_API_BASE = process.env.NEXT_PUBLIC_YOLO_API_URL || 'http://127.0.0.1:8000';

export interface YOLODetectionItem {
  id: string;
  class: string;
  label: string;
  confidence: number;
  x: number; // percentage
  y: number; // percentage
  w: number; // percentage
  h: number; // percentage
}

export interface YOLOFrameAnalysisResult {
  success: boolean;
  detections: YOLODetectionItem[];
  class_counts: {
    player: number;
    football: number;
    'football goal': number;
    'player with ball': number;
    [key: string]: number;
  };
  total_detections: number;
  inference_time_ms: number;
}

export interface YOLOVideoUploadResult {
  success: boolean;
  filename: string;
  saved_name: string;
  video_url: string;
  relative_url: string;
  duration: number;
  fps: number;
  resolution: string;
  size_bytes: number;
}

export type YOLOTimeline = Record<string, {
  timestamp: number;
  detections: YOLODetectionItem[];
  counts: Record<string, number>;
}>;

export interface YOLOVideoAnalysisResult {
  success: boolean;
  filename: string;
  video_url: string;
  duration: number;
  total_frames: number;
  frames_analyzed: number;
  timeline: YOLOTimeline;
  peak_class_counts: Record<string, number>;
  avg_class_counts: Record<string, number>;
}

export async function checkYOLOStatus(): Promise<{
  ready: boolean;
  classes?: Record<string, string>;
  error?: string;
}> {
  try {
    const res = await fetch(`${YOLO_API_BASE}/api/model-info`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      ready: data.status === 'ready',
      classes: data.classes,
    };
  } catch (err) {
    return {
      ready: false,
      error: err instanceof Error ? err.message : 'YOLO backend not reachable',
    };
  }
}

export async function analyzeFrameWithYOLO(
  imageBase64: string,
  confidenceThreshold: number = 0.25
): Promise<YOLOFrameAnalysisResult> {
  const res = await fetch(`${YOLO_API_BASE}/api/analyze-frame`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      image: imageBase64,
      confidence_threshold: confidenceThreshold,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Frame analysis failed (${res.status}): ${errorText}`);
  }

  return await res.json();
}

export async function uploadVideoToYOLO(file: File): Promise<YOLOVideoUploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${YOLO_API_BASE}/api/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Video upload failed (${res.status}): ${errorText}`);
  }

  return await res.json();
}

export async function analyzeVideoWithYOLO(
  fileOrFilename: File | string,
  sampleFps: number = 2.0,
  confidenceThreshold: number = 0.25
): Promise<YOLOVideoAnalysisResult> {
  const formData = new FormData();
  if (typeof fileOrFilename === 'string') {
    formData.append('video_filename', fileOrFilename);
  } else {
    formData.append('file', fileOrFilename);
  }
  formData.append('sample_fps', sampleFps.toString());
  formData.append('confidence_threshold', confidenceThreshold.toString());

  const res = await fetch(`${YOLO_API_BASE}/api/analyze-video`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Full video analysis failed (${res.status}): ${errorText}`);
  }

  return await res.json();
}
