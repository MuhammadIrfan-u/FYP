'use client';

import React, { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Sparkles,
  Eye,
  EyeOff,
  Crosshair,
  Zap,
} from 'lucide-react';
import { INITIAL_DETECTION_BOXES } from '@/lib/mockData';
import { DetectionBox } from '@/types/football';

interface TacticalVideoPlayerProps {
  imageSrc?: string;
  matchName?: string;
  duration?: string;
  confidenceThreshold?: number;
  onEventClick?: (time: string) => void;
  showTimeline?: boolean;
}

export const TacticalVideoPlayer: React.FC<TacticalVideoPlayerProps> = ({
  imageSrc = '/match_tactical_frame.jpg',
  matchName = 'FC Dynamo vs Rapid Stars - 1st Half',
  duration = '48:15',
  confidenceThreshold = 0.25,
  onEventClick,
  showTimeline = true,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(43); // 00:43
  const [speed, setSpeed] = useState<number>(1);
  const [showBoxes, setShowBoxes] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [showSpeed, setShowSpeed] = useState<boolean>(true);
  const [showAIOverlay, setShowAIOverlay] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Filter boxes by confidence threshold
  const visibleBoxes: DetectionBox[] = INITIAL_DETECTION_BOXES.filter((box) => {
    if (!showBoxes && box.class !== 'ai') return false;
    if (!showAIOverlay && box.class === 'ai') return false;
    return box.confidence >= confidenceThreshold;
  });

  // Playback timer simulation
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTimeSec((prev) => (prev >= 2895 ? 0 : prev + 1));
      }, 1000 / speed);
    }
    return () => clearInterval(interval);
  }, [isPlaying, speed]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getBoxStyle = (box: DetectionBox) => {
    switch (box.class) {
      case 'player':
        return {
          border: 'border-[#2563EB]',
          bg: 'bg-[#2563EB]/15',
          badge: 'bg-[#2563EB] text-white',
          glow: 'shadow-xs',
        };
      case 'ball':
        return {
          border: 'border-[#D97706]',
          bg: 'bg-[#D97706]/20',
          badge: 'bg-[#D97706] text-white',
          glow: 'shadow-xs',
        };
      case 'goal':
        return {
          border: 'border-[#DC2626]',
          bg: 'bg-[#DC2626]/15',
          badge: 'bg-[#DC2626] text-white',
          glow: 'shadow-xs',
        };
      case 'referee':
        return {
          border: 'border-[#555555]',
          bg: 'bg-[#555555]/20',
          badge: 'bg-[#555555] text-white',
          glow: 'shadow-xs',
        };
      case 'ai':
        return {
          border: 'border-[#7C3AED] border-dashed',
          bg: 'bg-[#7C3AED]/15 backdrop-blur-[2px]',
          badge: 'bg-[#7C3AED] text-white',
          glow: 'shadow-xs',
        };
      default:
        return {
          border: 'border-[#2563EB]',
          bg: 'bg-[#2563EB]/15',
          badge: 'bg-[#2563EB] text-white',
          glow: '',
        };
    }
  };

  // Timeline key events
  const timelineMarkers = [
    { sec: 8, label: '00:08 Pass #10', color: '#2563EB' },
    { sec: 21, label: '00:21 Dribble #7', color: '#16A34A' },
    { sec: 43, label: '00:43 Shot #10', color: '#D97706' },
    { sec: 72, label: '01:12 Sprint #11', color: '#2563EB' },
    { sec: 160, label: '02:40 Goal #9', color: '#DC2626' },
  ];

  return (
    <div
      className={`relative flex flex-col bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl overflow-hidden shadow-md ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none' : 'w-full'
      }`}
    >
      {/* Top Video Header Bar */}
      <div className="bg-[#F9F7F2] px-4 py-2.5 border-b border-[#E8E3D8] flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626] animate-pulse" />
            <span className="text-xs font-bold tracking-wider uppercase text-[#242424]">
              YOLOv11 Tactical Live Feed
            </span>
          </div>
          <span className="text-xs text-[#D9D3C5] hidden sm:inline">|</span>
          <span className="text-xs text-[#858585] font-medium hidden sm:inline">
            {matchName}
          </span>
        </div>

        {/* Quick Detection Layer Toggles */}
        <div className="flex items-center gap-1.5 text-xs">
          <button
            onClick={() => setShowBoxes(!showBoxes)}
            className={`px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-all ${
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
            className={`px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-all ${
              showLabels
                ? 'bg-[#262626] border-[#262626] text-white'
                : 'bg-[#FAF8F4] border-[#E8E3D8] text-[#555555] hover:text-[#242424]'
            }`}
            title="Toggle Class Labels & Confidence"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Confidence</span>
          </button>

          <button
            onClick={() => setShowSpeed(!showSpeed)}
            className={`px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-all ${
              showSpeed
                ? 'bg-[#262626] border-[#262626] text-white'
                : 'bg-[#FAF8F4] border-[#E8E3D8] text-[#555555] hover:text-[#242424]'
            }`}
            title="Toggle Velocity Tags"
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Velocity</span>
          </button>

          <button
            onClick={() => setShowAIOverlay(!showAIOverlay)}
            className={`px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-all ${
              showAIOverlay
                ? 'bg-[#7C3AED] border-[#7C3AED] text-white'
                : 'bg-[#FAF8F4] border-[#E8E3D8] text-[#555555] hover:text-[#242424]'
            }`}
            title="Toggle AI Tactical Advice"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden md:inline">AI Layer</span>
          </button>
        </div>
      </div>

      {/* Main Video Viewport & YOLO Overlays */}
      <div className="relative aspect-video w-full bg-[#1A1A1A] overflow-hidden group select-none">
        {/* Pitch Frame Image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt="Tactical Video Analysis"
          className="w-full h-full object-cover"
        />

        {/* Subtle Pitch Scanner Line on playback */}
        {isPlaying && (
          <div
            className="absolute inset-y-0 w-1 bg-gradient-to-b from-transparent via-white/80 to-transparent shadow-[0_0_10px_white] animate-pulse pointer-events-none transition-all duration-300"
            style={{ left: `${(currentTimeSec % 100)}%` }}
          />
        )}

        {/* YOLO Bounding Boxes Layer */}
        <div className="absolute inset-0 pointer-events-none">
          {visibleBoxes.map((box) => {
            const style = getBoxStyle(box);
            return (
              <div
                key={box.id}
                className={`absolute border-2 ${style.border} ${style.bg} ${style.glow} transition-all duration-150`}
                style={{
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.w}%`,
                  height: `${box.h}%`,
                }}
              >
                {/* YOLO Label & Confidence Badge */}
                {showLabels && (
                  <div
                    className={`absolute -top-5 left-0 px-1.5 py-0.2 rounded text-[10px] font-mono font-bold uppercase tracking-tight flex items-center gap-1 shadow-xs ${style.badge}`}
                  >
                    <span>{box.label}</span>
                    {box.jerseyNumber && (
                      <span className="opacity-90">#{box.jerseyNumber}</span>
                    )}
                  </div>
                )}

                {/* Velocity / Speed Tag */}
                {showSpeed && box.speed && (
                  <div className="absolute -bottom-4.5 right-0 bg-[#FAF8F4] border border-[#E8E3D8] text-[#242424] px-1 py-0.2 rounded text-[9px] font-mono font-bold shadow-xs">
                    {box.speed}
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

        {/* Pitch Tactical HUD Watermark */}
        <div className="absolute bottom-3 right-3 bg-[#FAF8F4]/90 backdrop-blur-md border border-[#E8E3D8] rounded-lg px-2.5 py-1 text-[11px] text-[#404040] flex items-center gap-2 pointer-events-none shadow-xs">
          <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
          <span>FPS: 30</span>
          <span>•</span>
          <span>1080p</span>
          <span>•</span>
          <span className="text-[#242424] font-bold">YOLO Football v11x</span>
        </div>
      </div>

      {/* Scrub Bar & Event Markers */}
      <div className="bg-[#F9F7F2] px-4 pt-3 pb-2 border-t border-[#E8E3D8] flex flex-col gap-2">
        <div className="relative w-full flex items-center">
          {/* Base progress track */}
          <div
            className="w-full h-2 bg-[#E8E3D8] rounded-full cursor-pointer relative overflow-hidden"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const percent = (e.clientX - rect.left) / rect.width;
              setCurrentTimeSec(Math.floor(percent * 2895));
            }}
          >
            {/* Filled progress bar */}
            <div
              className="h-full bg-[#262626] transition-all rounded-full"
              style={{ width: `${(currentTimeSec / 2895) * 100}%` }}
            />
          </div>

          {/* Timeline Event Markers */}
          {showTimeline &&
            timelineMarkers.map((m, idx) => {
              const posPercent = (m.sec / 2895) * 100;
              return (
                <button
                  key={`marker-${idx}`}
                  onClick={() => {
                    setCurrentTimeSec(m.sec);
                    if (onEventClick) onEventClick(m.label);
                  }}
                  title={m.label}
                  className="group/marker absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border border-white transition-transform hover:scale-150 z-10"
                  style={{
                    left: `${posPercent}%`,
                    backgroundColor: m.color,
                  }}
                >
                  <span className="opacity-0 group-hover/marker:opacity-100 transition-opacity absolute bottom-3.5 left-1/2 -translate-x-1/2 bg-[#FAF8F4] text-[#242424] border border-[#E8E3D8] text-[10px] font-bold px-2 py-0.5 rounded whitespace-nowrap shadow-md pointer-events-none">
                    {m.label}
                  </span>
                </button>
              );
            })}
        </div>

        {/* Video Control Buttons Row */}
        <div className="flex items-center justify-between text-xs pt-1">
          <div className="flex items-center gap-3">
            {/* Play/Pause */}
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-2 rounded-lg bg-[#262626] hover:bg-[#171717] text-white transition-all shadow-xs"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white" />}
            </button>

            {/* Restart */}
            <button
              onClick={() => setCurrentTimeSec(0)}
              className="p-2 rounded-lg bg-[#FAF8F4] hover:bg-[#EEEBE3] text-[#555555] border border-[#E8E3D8] transition-colors"
              title="Reset to 00:00"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Time Stamp */}
            <div className="font-mono text-[#404040] tracking-wider font-semibold">
              <span className="text-[#242424] font-bold">{formatTime(currentTimeSec)}</span>
              <span className="text-[#858585]"> / </span>
              <span className="text-[#858585]">{duration}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Playback Speed Switcher */}
            <div className="flex items-center bg-[#FAF8F4] border border-[#E8E3D8] rounded-lg p-0.5 text-[11px]">
              {[0.5, 1, 2].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`px-2 py-0.5 rounded font-mono transition-colors ${
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
              className="p-2 rounded-lg bg-[#FAF8F4] hover:bg-[#EEEBE3] text-[#555555] border border-[#E8E3D8] transition-colors"
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
