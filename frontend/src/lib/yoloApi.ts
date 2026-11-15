/**
 * YOLO Video Analytics API Client
 * Connects to the local FastAPI YOLO service running at http://127.0.0.1:8000
 */

export const YOLO_API_BASE = process.env.NEXT_PUBLIC_YOLO_API_URL || 'http://127.0.0.1:8000';

export function normalizeVideoUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('/')) {
    return `${YOLO_API_BASE}${url}`;
  }
  return url.replace(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/, YOLO_API_BASE);
}

export interface TeamClusterInfo {
  id: number;
  label: string;
  color_hex: string;
  color_rgb: number[];
  color_bgr?: number[];
  color_name: string;
  player_count: number;
  possession_frames: number;
  possession_pct: number;
  losses: number;
}

export interface PossessionCarrier {
  track_id: number | null;
  detection_id?: string;
  team: number;
  team_label: string;
  team_color_hex?: string;
  team_color_name?: string;
  confidence?: number;
  x?: number;
  y?: number;
}

export interface PossessionEventItem {
  id: string;
  timestamp: number;
  type: 'acquired' | 'not_lost' | 'lost';
  from_team: number | null;
  to_team: number;
  from_team_label?: string | null;
  to_team_label: string;
  from_player_id: number | null;
  to_player_id: number | null;
  possession_lost: boolean;
  status_label: string;
}

export interface PossessionState {
  teams: Record<string, TeamClusterInfo>;
  carrier: PossessionCarrier | null;
  current_team: number | null;
  current_team_label: string | null;
  previous_team: number | null;
  previous_carrier_id: number | null;
  player_changed: boolean;
  team_changed: boolean;
  possession_lost: boolean;
  possession_status: 'acquired' | 'holding' | 'not_lost' | 'lost' | 'in_transit' | 'no_carrier';
  status_label: string;
  total_possession_losses: number;
  total_same_team_passes: number;
  latest_event: PossessionEventItem | null;
}

export interface PossessionSummary {
  teams: Record<string, TeamClusterInfo>;
  current_team: number | null;
  current_team_label: string | null;
  total_possession_losses: number;
  total_same_team_passes: number;
  possession_events: PossessionEventItem[];
  frames_processed?: number;
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
  track_id?: number;
  team?: number;
  team_label?: string;
  team_color_hex?: string;
  team_color_rgb?: number[];
  team_color_name?: string;
  jersey_color_hex?: string;
  has_ball?: boolean;
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

export async function analyzeFrameWithYOLO(
  imageBase64: string,
  confidenceThreshold: number = 0.25,
  classConfidences?: Record<string, number>,
  sessionOptions?: {
    sessionId?: string;
    timestamp?: number;
    resetSession?: boolean;
  }
): Promise<YOLOFrameAnalysisResult> {
  const bodyPayload: Record<string, unknown> = {
    image: imageBase64,
    confidence_threshold: confidenceThreshold,
  };
  if (classConfidences) {
    bodyPayload.class_confidences = classConfidences;
  }
  if (sessionOptions?.sessionId) {
    bodyPayload.session_id = sessionOptions.sessionId;
  }
  if (sessionOptions?.timestamp !== undefined) {
    bodyPayload.timestamp = sessionOptions.timestamp;
  }
  if (sessionOptions?.resetSession) {
    bodyPayload.reset_session = true;
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
  possession?: PossessionState | null;
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
  infer_fps?: number;
  infer_interval?: number;
  class_confidences: Record<string, number>;
  chunks: AnnotatedChunk[];
  full_video_url: string | null;
  full_relative_url: string | null;
  possession_summary?: PossessionSummary | null;
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
  inferFps?: number;
}): Promise<{
  success: boolean;
  job_id: string;
  status: string;
  chunk_duration: number;
  infer_fps?: number;
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
  formData.append('infer_fps', (options.inferFps ?? 15.0).toString());

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

