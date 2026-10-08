export type PageId =
  | 'dashboard'
  | 'upload'
  | 'analysis'
  | 'events'
  | 'reports'
  | 'settings';

export type DetectionClass = 'player' | 'ball' | 'goal' | 'referee' | 'ai';

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
}

export type VideoStatus = 'Uploading' | 'Processing' | 'Analysing' | 'Completed' | 'Failed';

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
  };
  modelConfidence: number;
  metrics: {
    passes: number;
    shots: number;
    dribbles: number;
    sprints: number;
  };
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
