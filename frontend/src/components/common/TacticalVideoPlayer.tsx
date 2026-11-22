'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Eye,
  EyeOff,
  Crosshair,
  Zap,
  AlertCircle,
  ShieldAlert,
  ArrowRightLeft,
} from 'lucide-react';
import { DetectionBox, PossessionEventItem, PossessionState } from '@/types/football';
import {
  analyzeFrameWithYOLO,
  resetPossessionSession,
  toDetectionBox,
  YOLOTimeline,
} from '@/lib/yoloApi';

const LIVE_POLL_INTERVAL_MS = 100;
const BANNER_DURATION_MS = 2200;
const CARRIER_GOLD = '#F5B700';

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `live-${crypto.randomUUID()}`;
  }
  return `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface TacticalVideoPlayerProps {
  imageSrc?: string;
  videoUrl?: string;
  matchName?: string;
  duration?: string;
  confidenceThreshold?: number;
  classConfidences?: Record<string, number>;
  timeline?: YOLOTimeline;
  modelName?: string;
  onEventClick?: (time: string) => void;
  showTimeline?: boolean;
  onDetectionsUpdate?: (
    detections: DetectionBox[],
    counts: Record<string, number>,
    latencyMs: number,
    possession?: PossessionState | null
  ) => void;
  /** Called when the live tracking session restarts (new video or restart from 00:00). */
  onPossessionReset?: () => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

export const TacticalVideoPlayer: React.FC<TacticalVideoPlayerProps> = ({
  imageSrc = '/match_tactical_frame.jpg',
  videoUrl,
  matchName = 'Football Session',
  duration = '00:10',
  confidenceThreshold = 0.25,
  classConfidences,
  timeline,
  modelName = 'best_5.onnx',
  onDetectionsUpdate,
  onPossessionReset,
  onPlayStateChange,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef<boolean>(false);

  // Live possession session: ID created lazily inside callbacks (never during render).
  const sessionIdRef = useRef<string>('');
  const resetPendingRef = useRef<boolean>(true);
  const lastBannerEventIdRef = useRef<string | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [possession, setPossession] = useState<PossessionState | null>(null);
  const [bannerEvent, setBannerEvent] = useState<PossessionEventItem | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [totalDurationSec, setTotalDurationSec] = useState<number>(10);
  const [loadedDuration, setLoadedDuration] = useState<string | null>(null);
  const displayDuration = loadedDuration || duration || '00:10';
  const [speed, setSpeed] = useState<number>(1);
  const [showBoxes, setShowBoxes] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [showSpeed, setShowSpeed] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Video element playback & error state
  const [videoHasError, setVideoHasError] = useState<boolean>(false);

  // Active detections rendered over video (populated dynamically by YOLO model)
  const [currentBoxes, setCurrentBoxes] = useState<DetectionBox[]>([]);
  const [lastLatencyMs, setLastLatencyMs] = useState<number>(38);
  const [inferenceError, setInferenceError] = useState<string | null>(null);

  const getSessionId = useCallback(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current = createSessionId();
    }
    return sessionIdRef.current;
  }, []);

  // Show the Possession Lost / Not Lost popup once per backend event.
  const showPossessionBanner = useCallback((event: PossessionEventItem | null | undefined) => {
    if (!event || event.id === lastBannerEventIdRef.current) return;
    lastBannerEventIdRef.current = event.id;
    setBannerEvent(event);
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setBannerEvent(null), BANNER_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // Keep the latest reset callback without making the reset effect depend on it.
  const onPossessionResetRef = useRef(onPossessionReset);
  useEffect(() => {
    onPossessionResetRef.current = onPossessionReset;
  }, [onPossessionReset]);

  // Restart team clustering / tracking / possession counters on the backend.
  const restartPossessionSession = useCallback(() => {
    resetPendingRef.current = true;
    lastBannerEventIdRef.current = null;
    setPossession(null);
    setBannerEvent(null);
    if (sessionIdRef.current) {
      void resetPossessionSession(sessionIdRef.current);
    }
    onPossessionResetRef.current?.();
  }, []);

  // Reset when videoUrl changes
  useEffect(() => {
    restartPossessionSession();
    setVideoHasError(false);
    setCurrentBoxes([]);
    setLoadedDuration(null);
    if (videoUrl) {
      setIsPlaying(false);
      setCurrentTimeSec(0);
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
      }
    }
  }, [videoUrl, restartPossessionSession]);

  // Filter boxes by confidence threshold (incorporating per-class confidence if provided)
  const visibleBoxes: DetectionBox[] = currentBoxes.filter((box) => {
    if (!showBoxes) return false;
    const cls = box.class?.toLowerCase().trim() || '';
    const classThresh = classConfidences?.[cls] ?? confidenceThreshold ?? 0.25;
    return (box.confidence ?? 0) >= classThresh;
  });

  // Extract frame from HTML5 video or fallback tactical image and run YOLO inference
  const runFrameInference = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      let dataUrl: string | null = null;

      // Try reading from <video> if element is loaded and ready
      if (videoRef.current && videoRef.current.readyState >= 2 && !videoHasError) {
        const video = videoRef.current;
        const canvas = canvasRef.current || document.createElement('canvas');

        // Downscale to 640px max width for ~30KB payload (50x speedup in network & decode)
        const origW = video.videoWidth || 640;
        const origH = video.videoHeight || 360;
        const scale = Math.min(1, 640 / Math.max(origW, origH));
        const targetW = Math.max(320, Math.round(origW * scale));
        const targetH = Math.max(180, Math.round(origH * scale));

        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, targetW, targetH);
          dataUrl = canvas.toDataURL('image/jpeg', 0.65);
        }
      }

      // If video frame not available, capture fallback tactical frame image
      if (!dataUrl) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
          img.src = imageSrc || '/match_tactical_frame.jpg';
        });
        if (img.width > 0) {
          const canvas = canvasRef.current || document.createElement('canvas');
          const origW = img.width || 640;
          const origH = img.height || 360;
          const scale = Math.min(1, 640 / Math.max(origW, origH));
          const targetW = Math.max(320, Math.round(origW * scale));
          const targetH = Math.max(180, Math.round(origH * scale));

          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, targetW, targetH);
            dataUrl = canvas.toDataURL('image/jpeg', 0.65);
          }
        }
      }

      if (!dataUrl) return;

      const resetSession = resetPendingRef.current;
      resetPendingRef.current = false;
      const frameTime =
        videoRef.current && !videoHasError ? videoRef.current.currentTime : undefined;

      const res = await analyzeFrameWithYOLO(dataUrl, confidenceThreshold, classConfidences, {
        sessionId: getSessionId(),
        timestamp: frameTime,
        resetSession,
      });

      if (res && res.success) {
        setInferenceError(null);
        setLastLatencyMs(res.inference_time_ms || 40);

        const mappedBoxes: DetectionBox[] = res.detections.map(toDetectionBox);
        const framePossession = res.possession ?? null;

        setCurrentBoxes(mappedBoxes);
        setPossession(framePossession);
        showPossessionBanner(framePossession?.event);

        if (onDetectionsUpdate) {
          onDetectionsUpdate(mappedBoxes, res.class_counts, res.inference_time_ms, framePossession);
        }
      }
    } catch (err: unknown) {
      // Non-blocking error notice
      const msg = err instanceof Error ? err.message : String(err);
      if (msg && !msg.includes('abort')) {
        setInferenceError(msg);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [
    confidenceThreshold,
    classConfidences,
    onDetectionsUpdate,
    videoHasError,
    imageSrc,
    getSessionId,
    showPossessionBanner,
  ]);

  // Synchronize timeline detections if available
  const syncTimelineDetections = useCallback((timeSec: number) => {
    if (!timeline || Object.keys(timeline).length === 0) return false;

    // Find nearest timestamp in timeline
    const timestamps = Object.keys(timeline).map(Number).sort((a, b) => a - b);
    if (timestamps.length === 0) return false;

    // Find closest timestamp within 1 second
    let closest = timestamps[0];
    let minDiff = Math.abs(timeSec - closest);
    for (const ts of timestamps) {
      const diff = Math.abs(timeSec - ts);
      if (diff < minDiff) {
        minDiff = diff;
        closest = ts;
      }
    }

    if (minDiff <= 1.0) {
      const entry = timeline[closest.toFixed(2)] || timeline[closest.toString()];
      if (entry && entry.detections) {
        const mapped: DetectionBox[] = entry.detections.map(toDetectionBox);
        const entryPossession = entry.possession ?? null;
        setCurrentBoxes(mapped);
        setPossession(entryPossession);
        showPossessionBanner(entryPossession?.event);
        if (onDetectionsUpdate) {
          onDetectionsUpdate(mapped, entry.counts, lastLatencyMs, entryPossession);
        }
        return true;
      }
    }
    return false;
  }, [timeline, onDetectionsUpdate, lastLatencyMs, showPossessionBanner]);

  // Playback timer simulation when video element has error or fallback image is used
  useEffect(() => {
    if (!isPlaying) return;
    if (videoUrl && !videoHasError) return; // real video drives time

    const timer = setInterval(() => {
      setCurrentTimeSec((prev) => (prev >= totalDurationSec ? 0 : prev + 0.5));
    }, 500 / speed);

    return () => clearInterval(timer);
  }, [isPlaying, videoUrl, videoHasError, totalDurationSec, speed]);

  // Real-time analysis loop while video is playing
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    if (isPlaying) {
      // Run once immediately upon playing
      runFrameInference();

      // Poll every 100ms for smooth live tracking; the in-flight guard prevents overlapping requests
      intervalId = setInterval(() => {
        // If timeline didn't provide synchronized frame, run live frame inference
        const synchronized = syncTimelineDetections(currentTimeSec);
        if (!synchronized && !inFlightRef.current) {
          runFrameInference();
        }
      }, LIVE_POLL_INTERVAL_MS);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPlaying, currentTimeSec, runFrameInference, syncTimelineDetections]);

  // Handle Play/Pause safely without unhandled NotSupportedError
  const handleTogglePlay = async () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);
    if (onPlayStateChange) onPlayStateChange(nextState);

    if (videoUrl && videoRef.current && !videoHasError) {
      if (isPlaying) {
        try {
          videoRef.current.pause();
        } catch {
          // ignore
        }
      } else {
        try {
          await videoRef.current.play();
        } catch (err: unknown) {
          console.warn('HTML5 Video play error handled gracefully:', err);
          // If browser rejected playback (e.g. unsupported codec), fallback to timer + frame analysis
          setVideoHasError(true);
        }
      }
    }
  };

  const handleSpeedChange = (newSpeed: number) => {
    setSpeed(newSpeed);
    if (videoUrl && videoRef.current && !videoHasError) {
      videoRef.current.playbackRate = newSpeed;
    }
  };

  const handleSeek = (seconds: number) => {
    // Restarting from the beginning starts a fresh possession count.
    if (seconds === 0) restartPossessionSession();
    setCurrentTimeSec(seconds);
    if (videoUrl && videoRef.current && !videoHasError) {
      videoRef.current.currentTime = seconds;
    }
    syncTimelineDetections(seconds);
    setTimeout(() => runFrameInference(), 100);
  };

  const handleVideoTimeUpdate = () => {
    if (videoRef.current && !videoHasError) {
      const cur = videoRef.current.currentTime;
      setCurrentTimeSec(cur);
      syncTimelineDetections(cur);
    }
  };

  const handleVideoLoadedMetadata = () => {
    if (videoRef.current && videoRef.current.duration && !videoHasError) {
      const dur = Math.floor(videoRef.current.duration);
      setTotalDurationSec(dur);
      const m = Math.floor(dur / 60);
      const s = Math.floor(dur % 60);
      setLoadedDuration(`${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`);
      // Run initial detection frame
      runFrameInference();
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Dynamic box styling by class
  const getBoxStyle = (box: DetectionBox) => {
    const c = (box.class || '').toLowerCase();
    switch (c) {
      case 'football':
      case 'ball':
        return {
          border: 'border-[#D97706]',
          bg: 'bg-[#D97706]/20',
          badge: 'bg-[#D97706] text-white',
          name: 'Football',
        };
      case 'football goal':
      case 'goal':
        return {
          border: 'border-[#DC2626]',
          bg: 'bg-[#DC2626]/20',
          badge: 'bg-[#DC2626] text-white',
          name: 'Football Goal',
        };
      case 'player with ball':
        return {
          border: 'border-[#059669]',
          bg: 'bg-[#059669]/25',
          badge: 'bg-[#059669] text-white ring-1 ring-white/50',
          name: 'Player with Ball',
        };
      // Officials are detected so they can be kept out of team and possession
      // stats; they are drawn only so that exclusion is visible.
      case 'referee':
        return {
          border: 'border-[#3CB4FA]',
          bg: 'bg-[#3CB4FA]/20',
          badge: 'bg-[#3CB4FA] text-white',
          name: 'Referee',
        };
      case 'assistant_referee':
        return {
          border: 'border-[#78C8FA]',
          bg: 'bg-[#78C8FA]/20',
          badge: 'bg-[#78C8FA] text-white',
          name: 'Assistant Referee',
        };
      case 'referee':
        return {
          border: 'border-[#64748B]',
          bg: 'bg-[#64748B]/20',
          badge: 'bg-[#64748B] text-white',
          name: 'Referee',
        };
      case 'player':
      default:
        return {
          border: 'border-[#2563EB]',
          bg: 'bg-[#2563EB]/15',
          badge: 'bg-[#2563EB] text-white',
          name: 'Player',
        };
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl overflow-hidden shadow-md ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none h-screen' : 'w-full'
      }`}
    >
      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Top Header Status Bar */}
      <div className="bg-[#F9F7F2] px-4 py-2.5 border-b border-[#E8E3D8] flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isPlaying ? 'bg-[#16A34A] animate-ping' : 'bg-[#DC2626]'
              }`}
            />
            <span className="text-xs font-bold tracking-wider uppercase text-[#242424]">
              {isPlaying ? 'YOLO Model Live Inference' : 'Video Player Ready'}
            </span>
          </div>
          <span className="text-xs text-[#D9D3C5] hidden sm:inline">|</span>
          <span className="text-xs text-[#858585] font-medium truncate max-w-[200px] sm:max-w-xs">
            {matchName}
          </span>
        </div>

        {/* Layer Toggles & Status */}
        <div className="flex items-center gap-1.5 text-xs">
          <button
            onClick={() => setShowBoxes(!showBoxes)}
            className={`px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-all cursor-pointer ${
              showBoxes
                ? 'bg-[#262626] border-[#262626] text-white'
                : 'bg-[#FAF8F4] border-[#E8E3D8] text-[#555555] hover:text-[#242424]'
            }`}
            title="Toggle YOLO Bounding Boxes"
          >
            {showBoxes ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">Boxes</span>
          </button>

          <button
            onClick={() => setShowLabels(!showLabels)}
            className={`px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-all cursor-pointer ${
              showLabels
                ? 'bg-[#262626] border-[#262626] text-white'
                : 'bg-[#FAF8F4] border-[#E8E3D8] text-[#555555] hover:text-[#242424]'
            }`}
            title="Toggle Confidence Scores"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Confidence</span>
          </button>

          <button
            onClick={() => setShowSpeed(!showSpeed)}
            className={`px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-all cursor-pointer ${
              showSpeed
                ? 'bg-[#262626] border-[#262626] text-white'
                : 'bg-[#FAF8F4] border-[#E8E3D8] text-[#555555] hover:text-[#242424]'
            }`}
            title="Toggle Class Tag Badges"
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Class Tags</span>
          </button>
        </div>
      </div>

      {/* Main Video Viewport & YOLO Overlays */}
      <div className="relative aspect-video w-full bg-[#1A1A1A] overflow-hidden group select-none">
        {videoUrl && !videoHasError ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain"
            playsInline
            crossOrigin={videoUrl && !videoUrl.startsWith('blob:') ? 'anonymous' : undefined}
            onError={() => {
              console.warn('Video element source failed to load, checking fallback...');
              if (videoRef.current && videoRef.current.crossOrigin) {
                videoRef.current.removeAttribute('crossorigin');
                videoRef.current.load();
              } else {
                setVideoHasError(true);
              }
            }}
            onTimeUpdate={handleVideoTimeUpdate}
            onLoadedMetadata={handleVideoLoadedMetadata}
            onEnded={() => {
              setIsPlaying(false);
              if (onPlayStateChange) onPlayStateChange(false);
            }}
          />
        ) : (
          /* Fallback tactical image */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageSrc}
            alt="Tactical Video Analysis"
            className="w-full h-full object-cover"
          />
        )}

        {/* Scanner Line on playback */}
        {isPlaying && (
          <div
            className="absolute inset-y-0 w-0.5 bg-gradient-to-b from-transparent via-white/80 to-transparent shadow-[0_0_8px_white] pointer-events-none transition-all duration-150"
            style={{
              left: `${totalDurationSec > 0 ? (currentTimeSec / totalDurationSec) * 100 : (currentTimeSec % 100)}%`,
            }}
          />
        )}

        {/* YOLO Bounding Boxes Layer */}
        {showBoxes && (
          <div className="absolute inset-0 pointer-events-none">
            {visibleBoxes.map((box) => {
              const style = getBoxStyle(box);
              const teamHex = box.teamColorHex || null;
              const isCarrier = !!box.hasBall;
              const teamTag =
                box.teamId === 1 || box.teamId === 2
                  ? `T${box.teamId}`
                  : box.teamId === 0
                  ? 'OTH'
                  : null;
              const boxName =
                teamTag && box.trackId != null
                  ? `${teamTag} #${box.trackId}${isCarrier ? ' • Ball' : ''}`
                  : style.name;
              return (
                <div
                  key={box.id}
                  className={`absolute border-2 ${
                    teamHex ? '' : `${style.border} ${style.bg}`
                  } transition-all duration-150`}
                  style={{
                    left: `${box.x}%`,
                    top: `${box.y}%`,
                    width: `${box.w}%`,
                    height: `${box.h}%`,
                    ...(teamHex
                      ? { borderColor: teamHex, backgroundColor: `${teamHex}26` }
                      : {}),
                    ...(isCarrier
                      ? {
                          // Gold carrier highlight
                          boxShadow: `0 0 0 2px ${CARRIER_GOLD}, 0 0 14px ${CARRIER_GOLD}aa`,
                        }
                      : {}),
                  }}
                >
                  {/* Gold ground ring under the ball carrier's feet */}
                  {isCarrier && (
                    <span
                      className="absolute left-1/2 -translate-x-1/2 rounded-[50%] border-2 animate-pulse"
                      style={{
                        bottom: '-6px',
                        width: '140%',
                        height: '12px',
                        borderColor: CARRIER_GOLD,
                      }}
                    />
                  )}

                  {/* Class Label & Confidence Score Badge */}
                  {showLabels && (
                    <div
                      className={`absolute -top-5 left-0 px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-mono font-bold uppercase tracking-tight flex items-center gap-1 shadow-xs whitespace-nowrap ${
                        teamHex ? 'text-white' : style.badge
                      }`}
                      style={
                        teamHex
                          ? {
                              backgroundColor: teamHex,
                              outline: isCarrier ? `2px solid ${CARRIER_GOLD}` : undefined,
                              textShadow: '0 1px 1px rgba(0,0,0,0.6)',
                            }
                          : undefined
                      }
                    >
                      <span>{boxName}</span>
                      {box.confidence !== undefined && (
                        <span className="opacity-90 font-semibold">
                          {(box.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  )}

                  {/* Corner Crosshair Accents */}
                  <span className="absolute -top-1 -left-1 w-1.5 h-1.5 border-t-2 border-l-2 border-white/80" />
                  <span className="absolute -top-1 -right-1 w-1.5 h-1.5 border-t-2 border-r-2 border-white/80" />
                  <span className="absolute -bottom-1 -left-1 w-1.5 h-1.5 border-b-2 border-l-2 border-white/80" />
                  <span className="absolute -bottom-1 -right-1 w-1.5 h-1.5 border-b-2 border-r-2 border-white/80" />
                </div>
              );
            })}
          </div>
        )}

        {/* Real-time Model HUD Overlay */}
        <div className="absolute bottom-3 right-3 bg-[#FAF8F4]/90 backdrop-blur-md border border-[#E8E3D8] rounded-xl px-3 py-1.5 text-[11px] text-[#404040] flex items-center gap-2 pointer-events-none shadow-xs">
          <span
            className={`w-2 h-2 rounded-full ${
              isPlaying ? 'bg-[#16A34A] animate-pulse' : 'bg-[#D97706]'
            }`}
          />
          <span className="font-semibold text-[#242424]">Model: {modelName || 'best_5.onnx'}</span>
          <span>•</span>
          <span className="font-mono text-[#555555]">{lastLatencyMs}ms</span>
          <span>•</span>
          <span className="font-bold text-[#2563EB]">
            {visibleBoxes.length} Detections
          </span>
        </div>

        {/* Team 1 vs Team 2 possession HUD badge */}
        {possession && possession.teams_ready && (
          <div className="absolute top-3 left-3 bg-[#171717]/80 backdrop-blur-md border border-white/10 rounded-xl px-2.5 py-1.5 text-[10px] sm:text-[11px] text-white flex flex-col gap-1 pointer-events-none shadow-md min-w-[150px]">
            {possession.teams.map((t) => {
              const isHolding = possession.curr_team === t.team_id;
              return (
                <div key={t.team_id} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-sm border border-white/60"
                      style={{ backgroundColor: t.color_hex || '#999999' }}
                    />
                    <span className={`font-bold ${isHolding ? 'text-[#F5B700]' : ''}`}>
                      {t.label}
                    </span>
                    <span className="text-white/60">{t.color_name}</span>
                  </div>
                  <span className="font-mono font-bold">{t.possession_percent.toFixed(0)}%</span>
                </div>
              );
            })}
            <div className="h-1 w-full rounded-full overflow-hidden flex bg-white/20">
              {possession.teams.map((t) => (
                <div
                  key={t.team_id}
                  style={{
                    width: `${t.possession_percent}%`,
                    backgroundColor: t.color_hex || '#999999',
                  }}
                />
              ))}
            </div>
            <span className="text-[9px] font-mono text-white/70 uppercase tracking-wide">
              {possession.carrier
                ? `Ball: ${possession.carrier.team_label} #${possession.carrier.track_id}`
                : possession.status === 'in_transit'
                ? 'Ball in transit'
                : 'No carrier'}
            </span>
          </div>
        )}

        {/* Possession Lost / Not Lost popup banner */}
        {bannerEvent && (
          <div
            key={bannerEvent.id}
            className="absolute top-[18%] left-1/2 -translate-x-1/2 pointer-events-none z-10 animate-in fade-in zoom-in-90 slide-in-from-top-4 duration-300"
          >
            <div
              className={`px-4 sm:px-6 py-2.5 rounded-2xl border-2 shadow-xl text-white text-center ${
                bannerEvent.status === 'lost'
                  ? 'bg-[#DC2626]/90 border-[#FCA5A5]'
                  : 'bg-[#16A34A]/90 border-[#86EFAC]'
              }`}
            >
              <div className="flex items-center justify-center gap-2 text-sm sm:text-lg font-black tracking-wide uppercase">
                {bannerEvent.status === 'lost' ? (
                  <ShieldAlert className="w-5 h-5 animate-pulse" />
                ) : (
                  <ArrowRightLeft className="w-5 h-5" />
                )}
                <span>
                  {bannerEvent.status === 'lost'
                    ? 'Possession Lost!'
                    : 'Possession Not Lost (Same Team)'}
                </span>
              </div>
              <div className="text-[10px] sm:text-xs font-mono opacity-90 mt-0.5">
                {bannerEvent.description}
              </div>
            </div>
          </div>
        )}

        {/* Inference notice if error */}
        {inferenceError && (
          <div className="absolute top-3 right-3 bg-[#FEF2F2]/90 border border-[#FECACA] rounded-lg px-2.5 py-1 text-[11px] text-[#991B1B] flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-[#DC2626]" />
            <span>Inference notice: check backend connection</span>
          </div>
        )}
      </div>

      {/* Scrub Bar & Video Controls */}
      <div className="bg-[#F9F7F2] px-4 pt-3 pb-2 border-t border-[#E8E3D8] flex flex-col gap-2">
        <div className="relative w-full flex items-center">
          {/* Progress bar track */}
          <div
            className="w-full h-2 bg-[#E8E3D8] rounded-full cursor-pointer relative overflow-hidden"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const percent = (e.clientX - rect.left) / rect.width;
              handleSeek(percent * (totalDurationSec || 10));
            }}
          >
            <div
              className="h-full bg-[#262626] transition-all rounded-full"
              style={{
                width: `${totalDurationSec > 0 ? (currentTimeSec / totalDurationSec) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between text-xs pt-1">
          <div className="flex items-center gap-3">
            {/* Play/Pause Button */}
            <button
              onClick={handleTogglePlay}
              className="p-2 rounded-lg bg-[#262626] hover:bg-[#171717] text-white transition-all shadow-xs cursor-pointer"
              title={isPlaying ? 'Pause' : 'Play Video'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4 fill-white" />
              )}
            </button>

            {/* Reset Seek */}
            <button
              onClick={() => handleSeek(0)}
              className="p-2 rounded-lg bg-[#FAF8F4] hover:bg-[#EEEBE3] text-[#555555] border border-[#E8E3D8] transition-colors cursor-pointer"
              title="Reset to 00:00"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Time Stamp */}
            <div className="font-mono text-[#404040] tracking-wider font-semibold">
              <span className="text-[#242424] font-bold">
                {formatTime(currentTimeSec)}
              </span>
              <span className="text-[#858585]"> / </span>
              <span className="text-[#858585]">{displayDuration}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Speed Switcher */}
            <div className="flex items-center bg-[#FAF8F4] border border-[#E8E3D8] rounded-lg p-0.5 text-[11px]">
              {[0.5, 1, 2].map((s) => (
                <button
                  key={s}
                  onClick={() => handleSpeedChange(s)}
                  className={`px-2 py-0.5 rounded font-mono transition-colors cursor-pointer ${
                    speed === s
                      ? 'bg-[#262626] text-white font-bold'
                      : 'text-[#858585] hover:text-[#242424]'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            {/* Fullscreen Toggle */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 rounded-lg bg-[#FAF8F4] hover:bg-[#EEEBE3] text-[#555555] border border-[#E8E3D8] transition-colors cursor-pointer"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
