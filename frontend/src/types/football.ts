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
}

