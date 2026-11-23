export type PageId =
  | 'dashboard'
  | 'upload'
  | 'analysis'
  | 'sync_training'
  | 'events'
  | 'reports'
  | 'settings';

export type DetectionClass =
  | 'player'
  | 'football'
  | 'football goal'
  | 'player with ball'
  | 'ball'
  | 'goal'
  | 'referee'
  | 'ai'
  | string;

export interface DetectionBox {
  id: string;
  class: DetectionClass;
  label: string;
  confidence: number;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  w: number; // percentage width
  h: number; // percentage height
  jerseyNumber?: number;
  team?: 'Blue' | 'Red' | 'Ref';
  speed?: string;
  trail?: Array<[number, number]>;
  /** 1 or 2 for the clustered teams, 0 for an outlier (GK/referee), null if unknown. */
  teamId?: number | null;
  teamLabel?: string;
  teamColorHex?: string | null;
  teamColorName?: string | null;
  jerseyColorHex?: string | null;
  /** Persistent tracker ID (#1, #2, ...) across frames. */
  trackId?: number | null;
  hasBall?: boolean;
}

// ---------------------------------------------------------------------------
// Team clustering & ball possession (backend: app/services/team_possession.py)
// ---------------------------------------------------------------------------

export type PossessionStatus = 'idle' | 'holding' | 'not_lost' | 'lost' | 'in_transit';

export interface TeamClusterInfo {
  team_id: 1 | 2;
  label: string;
  color_hex: string | null;
  color_name: string | null;
  lab: number[] | null;
  player_count: number;
  frames_held: number;
  possession_percent: number;
  losses: number;
  passes: number;
}

export interface PossessionCarrier {
  track_id: number | null;
  team_id: number | null;
  team_label: string;
  team_color_hex: string | null;
  detection_id?: string | null;
  confidence?: number | null;
}

export interface PossessionEventItem {
  id: string;
  frame_index: number;
  timestamp: number | null;
  status: 'lost' | 'not_lost';
  possession_lost: boolean;
  from_player_id: number | null;
  from_team: number | null;
  to_player_id: number | null;
  to_team: number | null;
  description: string;
}

export interface PossessionPercent {
  team_1: number;
  team_2: number;
}

/** Per-frame possession state returned with each analyzed frame. */
export interface PossessionState {
  frame_index: number;
  timestamp: number | null;
  status: PossessionStatus;
  possession_status: PossessionStatus;
  possession_lost: boolean;
  carrier: PossessionCarrier | null;
  prev_player_id: number | null;
  prev_team: number | null;
  curr_player_id: number | null;
  curr_team: number | null;
  event: PossessionEventItem | null;
  teams: TeamClusterInfo[];
  possession_percent: PossessionPercent;
  total_losses: number;
  total_passes: number;
  teams_ready: boolean;
}

/** Cumulative possession for a whole clip / session / background job. */
export interface PossessionSummary {
  teams: TeamClusterInfo[];
  possession_percent: PossessionPercent;
  total_losses: number;
  total_passes: number;
  losses: Record<string, number>;
  passes: Record<string, number>;
  events: PossessionEventItem[];
  frames_processed: number;
  frames_with_carrier: number;
  current_status: PossessionStatus;
  current_carrier: PossessionCarrier | null;
  teams_ready: boolean;
  active_tracks: number;
}

/* ---------- Pitch calibration (homography view) ---------- */

export interface PitchLandmark {
  id: string;
  label: string;
  group: 'corners' | 'centre' | 'left' | 'right' | string;
  /** Pitch coordinates in metres (x along length, y from far touchline). */
  x: number;
  y: number;
}

/** A landmark placed on the frame, in source-video pixels. */
export interface PlacedLandmark {
  id: string;
  x: number;
  y: number;
}

export interface CalibrationQuality {
  points: number;
  model: 'homography' | 'homography+tps';
  homography_rmse_m: number;
  loo_rmse_m: number | null;
  per_point: { id: string; homography_error_m: number; loo_error_m: number | null }[];
}

export interface PitchCalibration {
  version: number;
  image_width: number;
  image_height: number;
  pitch_length: number;
  pitch_width: number;
  use_tps: boolean;
  homography: number[][];
  points: { id: string; image: [number, number]; pitch: [number, number] }[];
}

export interface CalibrationResult {
  success: boolean;
  saved: boolean;
  calibration: PitchCalibration;
  quality: CalibrationQuality;
  /** Projected pitch markings, polylines of [x%, y%] in frame coordinates. */
  overlay_lines: [number, number][][];
  warnings: string[];
}

/* ---------- Pitch-space match analytics ---------- */

export type MatchEventType = 'pass' | 'interception' | 'tackle' | 'goal' | 'out';

export interface MatchAnalyticsEvent {
  id: string;
  type: MatchEventType;
  timestamp: number;
  team?: number | null;
  from_player?: number;
  to_player?: number;
  from_team?: number;
  distance_m?: number;
  scorer?: number | null;
  own_goal?: boolean;
  goal_side?: 'left' | 'right';
  restart?: 'throw_in' | 'corner' | 'goal_kick';
  score?: { team_1: number; team_2: number };
  start?: [number, number];
  end?: [number, number];
  description: string;
}

export interface MatchTeamStats {
  team_id: number;
  possession_percent: number;
  possession_sec: number;
  control_sec: number;
  passes_completed: number;
  passes_attempted: number;
  pass_accuracy: number | null;
  interceptions: number;
  tackles: number;
  turnovers: number;
  goals: number;
  distance_km: number;
  mean_x_m: number | null;
  shape: TeamShape | null;
}

/** Average team shape (outfield block, extreme player at each end excluded). */
export interface TeamShape {
  samples: number;
  avg_width_m: number;
  avg_depth_m: number;
  avg_centroid: [number, number];
  defending_side: 'left' | 'right' | null;
  attacking_direction: 'left' | 'right' | null;
  /** Distance of the last outfield line from the team's own goal line. */
  defensive_line_height_m: number | null;
}

export type HeatmapPhase = 'all' | 'in_possession' | 'out_of_possession';

/** Tactical heatmaps written to heatmaps.json ([row = y cell][col = x cell]). */
export interface TacticalHeatmaps {
  cell_m: number;
  nx: number;
  ny: number;
  pitch: { length: number; width: number };
  teams: { team_1: Record<HeatmapPhase, number[][]>; team_2: Record<HeatmapPhase, number[][]> };
  ball: number[][];
  players: Record<
    string,
    {
      track_id: number;
      team: number | null;
      samples: number;
      avg_position: [number, number];
      /** Sparse cells: [x cell, y cell, count]. */
      cells: [number, number, number][];
    }
  >;
  shape: { team_1: TeamShape | null; team_2: TeamShape | null };
}

export interface MatchPlayerStats {
  track_id: number;
  team: number | null;
  samples: number;
  distance_m: number;
  max_speed_kmh: number;
  avg_x_m: number;
  avg_y_m: number;
  touches: number;
  passes_completed: number;
  passes_received: number;
  turnovers: number;
  possession_sec: number;
  goals: number;
}

export interface MatchStats {
  calibrated: boolean;
  pitch: { length: number; width: number };
  duration_analyzed_sec: number;
  samples: number;
  score: { team_1: number; team_2: number };
  possession_percent: PossessionPercent;
  teams: { team_1: MatchTeamStats; team_2: MatchTeamStats };
  attacking: { team_defending_left_goal: number | null; team_defending_right_goal: number | null };
  ball: {
    samples: number;
    detected_percent: number;
    distance_m: number;
    in_play: boolean;
    last_position: [number, number] | null;
  };
  event_counts: Partial<Record<MatchEventType, number>>;
  goals: MatchAnalyticsEvent[];
  events: MatchAnalyticsEvent[];
  players: MatchPlayerStats[];
  pass_network: { from: number; to: number; count: number }[];
}

export type VideoStatus = 'Uploading' | 'Processing' | 'Analysing' | 'Completed' | 'Failed' | 'Uploaded';

export interface MatchVideo {
  id: string;
  filename: string;
  matchName: string;
  date: string;
  duration: string;
  size: string;
  status: VideoStatus;
  progress: number;
  thumbnail: string;
  detections: {
    players: number;
    ball: number;
    goals: number;
    referee: number;
    player_with_ball?: number;
  };
  classCounts?: {
    player?: number;
    football?: number;
    'football goal'?: number;
    'player with ball'?: number;
    [key: string]: number | undefined;
  };
  modelConfidence: number;
  timeline?: Record<string, unknown>;
  metrics: {
    passes: number;
    shots: number;
    dribbles: number;
    sprints: number;
  };
  videoPath?: string;
  videoUrl?: string;
  savedFilename?: string;
  userId?: string;
  rawDurationSeconds?: number;
}

export interface PlayerStats {
  id: string;
  number: number;
  name: string;
  position: string;
  team: string;
  role: string;
  avatar: string;
  distanceCovered: string;
  topSpeed: string;
  passAccuracy: string;
  passesCompleted: string;
  successfulDribbles: string;
  shotsOnTarget: string;
  sprints: number;
  stamina: string;
  minutesPlayed: number;
  rating: number;
  heatPoints: Array<{ x: number; y: number; intensity: number }>;
  movementPath: Array<{ x: number; y: number; label?: string; speed?: number; type: 'jog' | 'sprint' | 'walk' | 'touch' }>;
  activityIntervals: Array<{ interval: string; distanceKm: number; topSpeedKmH: number; passAcc: number }>;
}

export interface MatchEvent {
  id: string;
  time: string;
  type: 'Pass' | 'Dribble' | 'Shot' | 'Sprint' | 'Goal' | 'Interception';
  playerNumber: number;
  playerName: string;
  team: string;
  outcome: string;
  details: string;
  timestampSeconds: number;
  targetPlayer?: {
    number: number;
    name: string;
  };
  passTrajectory?: {
    from: { x: number; y: number; label: string };
    to: { x: number; y: number; label: string };
    distanceMeters: number;
    curveType: 'straight' | 'through' | 'cross';
    success: boolean;
  };
}

export interface PassNetworkNode {
  id: string;
  num: number;
  name: string;
  pos: string;
  x: number; // pitch %
  y: number; // pitch %
  touches: number;
}

export interface PassNetworkLink {
  from: string;
  to: string;
  count: number;
  weight: number; // 1-5
}

export interface TeamStats {
  possession: number;
  passAccuracy: number;
  shots: number;
  shotsOnTarget: number;
  distanceCovered: string;
  formation: string;
  passesCompleted: string;
  passNetworkNodes: PassNetworkNode[];
  passNetworkLinks: PassNetworkLink[];
  attackingZones: {
    left: number;
    center: number;
    right: number;
  };
  defensiveZones: {
    highPress: number;
    midBlock: number;
    deepDefending: number;
  };
  possessionTimeline: Array<{ minute: string; dynamo: number; rapid: number }>;
}

export interface TrainingDrill {
  id: string;
  name: string;
  category: 'Recommended' | 'Dribbling' | 'Passing' | 'Shooting' | 'Defending' | 'Fitness';
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  duration: string;
  description: string;
  focusAreas: string[];
  image: string;
  aiRecommendedReason?: string;
}

export interface ReportItem {
  id: string;
  title: string;
  match: string;
  date: string;
  type: 'Match Report' | 'Player Report' | 'Team Performance';
  status: 'Ready' | 'Processing';
  fileSize: string;
  summary: string;
  keyMetrics: { label: string; value: string }[];
}

export interface TeamProfileSettings {
  teamName: string;
  coachName: string;
  coachLicense: string;
  season: string;
  formation: string;
  primaryColor: string;
  secondaryColor: string;
  stadium: string;
  autoDetectHeatmaps: boolean;
  yoloThreshold: number;
  frameSamplingRate: number;
  alertOnHighFatigue: boolean;
}

export interface SyncVideoChannel {
  name: string;
  filename: string;
  video_url: string;
  duration: number;
  clap_time: number;
  has_clap: boolean;
  start_delay?: number;
  waveform: number[];
}

/** Background job that merges Camera 1 + Camera 2 into one side-by-side MP4. */
export interface MergeJob {
  job_id: string;
  status: 'processing' | 'completed' | 'failed';
  progress_percent: number;
  processed_seconds: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  size_bytes: number;
  has_audio: boolean;
  source_a: string;
  source_b: string;
  start_delay_a: number;
  start_delay_b: number;
  /** Where each feed was cut so merged 0:00 is the shared sync moment. */
  trim_start_a: number;
  trim_start_b: number;
  trim_to_overlap: boolean;
  merged_filename: string;
  relative_url: string | null;
  merged_video_url: string | null;
  error: string | null;
}

export interface SyncTrainingResult {
  success: boolean;
  sync_id: string;
  video_a: SyncVideoChannel;
  video_b: SyncVideoChannel;
  started_first?: 'video_a' | 'video_b' | 'same_time';
  start_difference?: number;
  master_clap_time?: number;
  total_master_duration?: number;
  offset_seconds: number;
  sync_method: 'first_loudest_clap' | 'clap_transient' | 'cross_correlation' | 'default';
  confidence: number;
  message: string;
  /** True when the two detected claps disagreed with the audio and were re-anchored. */
  clap_corrected?: boolean;
  alignment?: {
    method: 'clap_confirmed' | 'clap_unverified' | 'audio_correlation' | 'clap_only' | 'default';
    clap_trusted: boolean;
    clap_corrected: boolean;
    clap_offset: number | null;
    clap_score: number;
    audio_offset: number | null;
    audio_score: number;
  };
}

