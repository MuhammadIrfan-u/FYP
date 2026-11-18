/**
 * YOLO Video Analytics API Client
 * Connects to the local FastAPI YOLO service running at http://127.0.0.1:8000
 */

import type {
  CalibrationResult,
  DetectionBox,
  DetectionClass,
  MatchStats,
  PitchLandmark,
  PlacedLandmark,
  PossessionState,
  PossessionSummary,
  TacticalHeatmaps,
} from '@/types/football';

export const YOLO_API_BASE = process.env.NEXT_PUBLIC_YOLO_API_URL || 'http://127.0.0.1:8000';

export function normalizeVideoUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('/')) {
    return `${YOLO_API_BASE}${url}`;
  }
  return url.replace(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/, YOLO_API_BASE);
}

export interface YOLODetectionItem {
  id: string;
  class: string;
  label: string;
  confidence: number;
  x: number; // percentage
  y: number; // percentage
  w: number; // percentage
  h: number; // percentage
  // Team clustering & tracking (players only)
  team_id?: number | null;
  team_label?: string;
  team_color_hex?: string | null;
  team_color_name?: string | null;
  jersey_color_hex?: string | null;
  jersey_color_name?: string | null;
  track_id?: number | null;
  has_ball?: boolean;
}

/** Map an API detection (snake_case) to the UI DetectionBox (camelCase). */
export function toDetectionBox(d: YOLODetectionItem): DetectionBox {
  return {
    id: d.id,
    class: d.class as DetectionClass,
    label: d.label,
    confidence: d.confidence,
    x: d.x,
    y: d.y,
    w: d.w,
    h: d.h,
    teamId: d.team_id ?? null,
    teamLabel: d.team_label,
    teamColorHex: d.team_color_hex ?? null,
    teamColorName: d.team_color_name ?? null,
    jerseyColorHex: d.jersey_color_hex ?? null,
    trackId: d.track_id ?? null,
    hasBall: d.has_ball ?? false,
  };
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
  session_id?: string | null;
  possession?: PossessionState;
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
  possession?: PossessionState;
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
  sample_fps?: number;
  frame_step?: number;
  possession_summary?: PossessionSummary;
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

export interface FrameSessionOptions {
  /** Stable ID so the backend keeps team clusters, tracks and possession across frames. */
  sessionId?: string;
  /** Video time of the frame in seconds. */
  timestamp?: number;
  /** Clear the session's tracker before processing this frame. */
  resetSession?: boolean;
}

export async function analyzeFrameWithYOLO(
  imageBase64: string,
  confidenceThreshold: number = 0.25,
  classConfidences?: Record<string, number>,
  session?: FrameSessionOptions
): Promise<YOLOFrameAnalysisResult> {
  const bodyPayload: Record<string, unknown> = {
    image: imageBase64,
    confidence_threshold: confidenceThreshold,
  };
  if (classConfidences) {
    bodyPayload.class_confidences = classConfidences;
  }
  if (session?.sessionId) {
    bodyPayload.session_id = session.sessionId;
    bodyPayload.reset_session = session.resetSession ?? false;
  }
  if (session?.timestamp !== undefined && Number.isFinite(session.timestamp)) {
    bodyPayload.timestamp = session.timestamp;
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

export async function resetPossessionSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${YOLO_API_BASE}/api/possession/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
  } catch {
    // Non-critical: the next frame can also request reset_session.
  }
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

  const data: YOLOVideoUploadResult = await res.json();
  if (data.video_url) {
    data.video_url = normalizeVideoUrl(data.relative_url || data.video_url);
  }
  return data;
}

export async function analyzeVideoWithYOLO(
  fileOrFilename: File | string,
  sampleFps: number = 10.0,
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

  const data: YOLOVideoAnalysisResult = await res.json();
  if (data.video_url) {
    data.video_url = normalizeVideoUrl(data.video_url);
  }
  return data;
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
  possession?: {
    possession_percent: { team_1: number; team_2: number };
    total_losses: number;
    total_passes: number;
    events: PossessionSummary['events'];
  };
  match_events?: MatchStats['events'];
  /** Passes between players completed in this 5s chunk (team-agnostic). */
  passes?: number;
  pass_events?: PassEvent[];
}

export interface PassEvent {
  from_player: number;
  to_player: number;
  /** Seconds in the full video: ball leaves passer / reaches receiver. */
  start_time: number;
  end_time: number;
  /** Feet positions normalised to the frame (0..1). */
  from_xy: [number, number];
  to_xy: [number, number];
  /** Pitch metres, only when the video has a landmark calibration. */
  from_pitch?: [number, number];
  to_pitch?: [number, number];
}

export interface MatchLogUrls {
  players_csv: string;
  ball_csv: string;
  events_json: string;
  match_stats_json: string;
  heatmaps_json?: string;
}

/** Tactical heatmaps (team x phase, ball, per player) for a background job. */
export async function fetchTacticalHeatmaps(url: string): Promise<TacticalHeatmaps | null> {
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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
  infer_fps?: number;
  infer_interval_frames?: number | null;
  possession_summary?: PossessionSummary | null;
  /** True when a landmark (homography) calibration was applied. */
  calibrated?: boolean;
  match_stats?: MatchStats | null;
  /** Running total of passes across completed 5s chunks (no double counting). */
  total_passes?: number;
  /** Started from the Passes tab: no team classification or match analytics. */
  passes_only?: boolean;
  logs?: MatchLogUrls | null;
  resolution?: string;
  output_resolution?: string;
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
  /** Inference rate for chunk rendering (15 fps = 2-frame stride on 30 fps video). */
  inferFps?: number;
  /** Refuse to start when no landmark calibration is saved for the video. */
  requireCalibration?: boolean;
  /** Only analyse the first N seconds (useful for long full-match videos). */
  maxDuration?: number;
  /** Pass counting only: skips team classification and possession analytics. */
  passesOnly?: boolean;
}): Promise<{
  success: boolean;
  job_id: string;
  status: string;
  chunk_duration: number;
  class_confidences: Record<string, number>;
  infer_fps?: number;
  message: string;
}> {
  const formData = new FormData();
  if (options.file) formData.append('file', options.file);
  if (options.videoFilename) formData.append('video_filename', options.videoFilename);
  if (options.videoUrl) formData.append('video_url', options.videoUrl);
  formData.append('chunk_duration', (options.chunkDuration ?? 5.0).toString());
  formData.append('confidence_threshold', (options.confidenceThreshold ?? 0.25).toString());
  formData.append('burn_boxes', (options.burnBoxes ?? true).toString());
  formData.append('infer_fps', (options.inferFps ?? 15.0).toString());
  if (options.requireCalibration) formData.append('require_calibration', 'true');
  if (options.passesOnly) formData.append('passes_only', 'true');
  if (options.maxDuration && options.maxDuration > 0) {
    formData.append('max_duration', options.maxDuration.toString());
  }

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

  const job: BackgroundAnnotationJob = await res.json();
  if (job.logs) {
    job.logs = {
      players_csv: normalizeVideoUrl(job.logs.players_csv),
      ball_csv: normalizeVideoUrl(job.logs.ball_csv),
      events_json: normalizeVideoUrl(job.logs.events_json),
      match_stats_json: normalizeVideoUrl(job.logs.match_stats_json),
      heatmaps_json: job.logs.heatmaps_json ? normalizeVideoUrl(job.logs.heatmaps_json) : undefined,
    };
  }
  if (job.full_video_url) {
    job.full_video_url = normalizeVideoUrl(job.full_relative_url || job.full_video_url);
  }
  if (job.chunks && Array.isArray(job.chunks)) {
    job.chunks = job.chunks.map((chunk) => ({
      ...chunk,
      video_url: normalizeVideoUrl(chunk.relative_url || chunk.video_url),
    }));
  }
  return job;
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
  const jobs: BackgroundAnnotationJob[] = data.jobs || [];
  return jobs.map((job) => ({
    ...job,
    full_video_url: normalizeVideoUrl(job.full_relative_url || job.full_video_url),
    chunks: (job.chunks || []).map((chunk) => ({
      ...chunk,
      video_url: normalizeVideoUrl(chunk.relative_url || chunk.video_url),
    })),
  }));
}

/* ---------- Pitch calibration (drag-and-drop landmarks) ---------- */

export async function getPitchLandmarks(
  length = 105,
  width = 68
): Promise<{ landmarks: PitchLandmark[]; min_points: number; recommended_points: number }> {
  const res = await fetch(
    `${YOLO_API_BASE}/api/pitch/landmarks?length=${length}&width=${width}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) throw new Error(`Failed to load pitch landmarks (${res.status})`);
  return res.json();
}

/** JPEG frame of an uploaded video used as the calibration canvas. */
export function videoFrameUrl(videoFilename: string, t = 1.0): string {
  const params = new URLSearchParams({ video_filename: videoFilename, t: t.toString() });
  return `${YOLO_API_BASE}/api/video-frame?${params.toString()}`;
}

export async function computeHomography(payload: {
  videoFilename: string;
  imageWidth: number;
  imageHeight: number;
  pitchLength: number;
  pitchWidth: number;
  points: PlacedLandmark[];
  save?: boolean;
}): Promise<CalibrationResult> {
  const res = await fetch(`${YOLO_API_BASE}/api/homography`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      video_filename: payload.videoFilename,
      image_width: payload.imageWidth,
      image_height: payload.imageHeight,
      pitch_length: payload.pitchLength,
      pitch_width: payload.pitchWidth,
      points: payload.points,
      save: payload.save ?? true,
    }),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      // keep status code
    }
    throw new Error(`Calibration failed: ${detail}`);
  }
  return res.json();
}

/** Saved calibration for a video, or null if none exists. */
export async function getSavedHomography(videoFilename: string): Promise<CalibrationResult | null> {
  try {
    const res = await fetch(
      `${YOLO_API_BASE}/api/homography?video_filename=${encodeURIComponent(videoFilename)}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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

  const data = await res.json();
  if (data.video_a?.video_url) {
    data.video_a.video_url = normalizeVideoUrl(data.video_a.video_url);
  }
  if (data.video_b?.video_url) {
    data.video_b.video_url = normalizeVideoUrl(data.video_b.video_url);
  }
  return data;
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

  const data = await res.json();
  return {
    ...data,
    synced_video_url: normalizeVideoUrl(data.relative_url || data.synced_video_url),
  };
}

