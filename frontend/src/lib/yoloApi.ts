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
  model_file?: string;
  format?: string;
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
      model_file: data.model_file || 'best_5.onnx',
      format: data.format || 'onnx',
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
  confidenceThreshold: number = 0.25,
  classConfidences?: Record<string, number>
): Promise<YOLOFrameAnalysisResult> {
  const bodyPayload: Record<string, unknown> = {
    image: imageBase64,
    confidence_threshold: confidenceThreshold,
  };
  if (classConfidences) {
    bodyPayload.class_confidences = classConfidences;
  }

  const res = await fetch(`${YOLO_API_BASE}/api/analyze-frame`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(bodyPayload),
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
  confidenceThreshold: number = 0.25,
  classConfidences?: Record<string, number>
): Promise<YOLOVideoAnalysisResult> {
  const formData = new FormData();
  if (typeof fileOrFilename === 'string') {
    formData.append('video_filename', fileOrFilename);
  } else {
    formData.append('file', fileOrFilename);
  }
  formData.append('sample_fps', sampleFps.toString());
  formData.append('confidence_threshold', confidenceThreshold.toString());
  if (classConfidences) {
    formData.append('class_confidences', JSON.stringify(classConfidences));
  }

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

export interface AnnotatedChunk {
  chunk_index: number;
  start_time: number;
  end_time: number;
  duration: number;
  video_url: string;
  relative_url: string;
  counts: Record<string, number>;
  detections_count: number;
  frames: number;
}

export interface BackgroundAnnotationJob {
  job_id: string;
  status: 'processing' | 'completed' | 'failed';
  progress_percent: number;
  total_chunks: number;
  completed_chunks: number;
  current_chunk_processing: number;
  duration_sec: number;
  chunk_duration_sec: number;
  confidence_threshold: number;
  class_confidences: Record<string, number>;
  chunks: AnnotatedChunk[];
  full_video_url: string | null;
  full_relative_url: string | null;
  error: string | null;
}

export async function startBackgroundAnnotation(options: {
  file?: File;
  videoFilename?: string;
  videoUrl?: string;
  chunkDuration?: number;
  confidenceThreshold?: number;
  classConfidences?: Record<string, number>;
  burnBoxes?: boolean;
}): Promise<{
  success: boolean;
  job_id: string;
  status: string;
  chunk_duration: number;
  class_confidences: Record<string, number>;
  message: string;
}> {
  const formData = new FormData();
  if (options.file) formData.append('file', options.file);
  if (options.videoFilename) formData.append('video_filename', options.videoFilename);
  if (options.videoUrl) formData.append('video_url', options.videoUrl);
  formData.append('chunk_duration', (options.chunkDuration ?? 5.0).toString());
  formData.append('confidence_threshold', (options.confidenceThreshold ?? 0.25).toString());
  formData.append('burn_boxes', (options.burnBoxes ?? true).toString());

  if (options.classConfidences) {
    formData.append('class_confidences', JSON.stringify(options.classConfidences));
  }

  const res = await fetch(`${YOLO_API_BASE}/api/background-annotate`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Start background annotation failed (${res.status}): ${errorText}`);
  }

  return await res.json();
}

export async function getBackgroundJobStatus(jobId: string): Promise<BackgroundAnnotationJob> {
  const res = await fetch(`${YOLO_API_BASE}/api/background-jobs/${jobId}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to get job status (${res.status}): ${errorText}`);
  }

  return await res.json();
}

export async function listBackgroundJobs(): Promise<BackgroundAnnotationJob[]> {
  const res = await fetch(`${YOLO_API_BASE}/api/background-jobs`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    return [];
  }

  const data = await res.json();
  return data.jobs || [];
}

export interface SyncVideosPayload {
  fileA?: File;
  fileB?: File;
  videoAFilename?: string;
  videoBFilename?: string;
}

export async function syncTrainingVideos(payload: SyncVideosPayload) {
  const formData = new FormData();
  if (payload.fileA) formData.append('file_a', payload.fileA);
  if (payload.fileB) formData.append('file_b', payload.fileB);
  if (payload.videoAFilename) formData.append('video_a_filename', payload.videoAFilename);
  if (payload.videoBFilename) formData.append('video_b_filename', payload.videoBFilename);

  const res = await fetch(`${YOLO_API_BASE}/api/sync-training-videos`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Video synchronization failed (${res.status}): ${errorText}`);
  }

  return await res.json();
}

export async function renderSyncedVideo(params: {
  videoAFilename: string;
  videoBFilename: string;
  offsetSeconds: number;
  startDelayA?: number;
  startDelayB?: number;
}): Promise<{
  success: boolean;
  synced_video_url: string;
  relative_url: string;
}> {
  const res = await fetch(`${YOLO_API_BASE}/api/render-synced-video`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_a_filename: params.videoAFilename,
      video_b_filename: params.videoBFilename,
      offset_seconds: params.offsetSeconds,
      start_delay_a: params.startDelayA ?? 0.0,
      start_delay_b: params.startDelayB ?? 0.0,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to render synchronized video (${res.status}): ${errorText}`);
  }

  return await res.json();
}

