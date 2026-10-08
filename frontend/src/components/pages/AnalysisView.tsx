'use client';

import React, { useState } from 'react';
import {
  Cpu,
  Layers,
  Flame,
  Share2,
  Activity,
  Code,
  Sliders,
  CheckCircle2,
  Clock,
  Film,
  Sparkles,
  Download,
  Eye,
  Crosshair,
  TrendingUp,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { StatusBadge } from '@/components/common/StatusBadge';
import { TacticalVideoPlayer } from '@/components/common/TacticalVideoPlayer';
import { FootballPitch } from '@/components/common/FootballPitch';
import { INITIAL_DETECTION_BOXES } from '@/lib/mockData';

export const AnalysisView: React.FC = () => {
  const {
    activeVideo,
    confidenceThreshold,
    setConfidenceThreshold,
    activeVideoTab,
    setActiveVideoTab,
    teamStats,
    selectedPlayer,
    events,
    setSelectedEvent,
  } = useFootball();

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Film },
    { id: 'tracking', label: 'Player Tracking', icon: Crosshair },
    { id: 'heatmap', label: 'Heatmap', icon: Flame },
    { id: 'pass_network', label: 'Pass Network', icon: Share2 },
    { id: 'events', label: 'Events', icon: Activity },
    { id: 'raw', label: 'Raw Data', icon: Code },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. TOP HEADER & METADATA BAR */}
      <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-xl sm:text-2xl font-black text-[#F8FAFC] tracking-tight">
              Analysis Results
            </h3>
            <StatusBadge status={activeVideo.status} size="sm" />
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-[#94A3B8] font-mono">
            <span className="text-[#F8FAFC] font-semibold">{activeVideo.filename}</span>
            <span>•</span>
            <span>{activeVideo.matchName}</span>
            <span>•</span>
            <span>{activeVideo.date}</span>
            <span>•</span>
            <span className="text-[#3B82F6]">Duration: {activeVideo.duration}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-xl bg-[#09162A] border border-[#1B3554] text-xs font-mono text-[#CBD5E1] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
            <span>YOLOv11 Pipeline: 100% Processed</span>
          </div>
        </div>
      </div>

      {/* 2. SUB-NAVIGATION TABS */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-[#1B3554]/70">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeVideoTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveVideoTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-[#0B5CFF] text-white shadow-md shadow-blue-500/25'
                  : 'text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#0D203B]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 3. MAIN CONTENT BASED ON SELECTED TAB */}
      {activeVideoTab === 'overview' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left: Large Video Player with Computer Vision Overlays */}
          <div className="xl:col-span-8 space-y-4">
            <TacticalVideoPlayer
              imageSrc={activeVideo.thumbnail || '/match_tactical_frame.jpg'}
              matchName={activeVideo.matchName}
              duration={activeVideo.duration}
              confidenceThreshold={confidenceThreshold}
              showTimeline={true}
            />

            {/* Analysis Key Metric Row below video */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-4 shadow-lg text-center">
              <div>
                <span className="text-[11px] text-[#94A3B8] font-medium block">
                  Ball Retention
                </span>
                <span className="text-xl font-black text-[#22C55E] mt-0.5 block">
                  58%
                </span>
              </div>
              <div>
                <span className="text-[11px] text-[#94A3B8] font-medium block">
                  Field Tilt (Offense)
                </span>
                <span className="text-xl font-black text-[#3B82F6] mt-0.5 block">
                  64.2%
                </span>
              </div>
              <div>
                <span className="text-[11px] text-[#94A3B8] font-medium block">
                  Expected Goals (xG)
                </span>
                <span className="text-xl font-black text-[#FBBF24] mt-0.5 block">
                  2.14
                </span>
              </div>
              <div>
                <span className="text-[11px] text-[#94A3B8] font-medium block">
                  Counter-Press Time
                </span>
                <span className="text-xl font-black text-[#8B5CF6] mt-0.5 block">
                  4.8s avg
                </span>
              </div>
            </div>
          </div>

          {/* Right: Detected Classes & Model Confidence */}
          <div className="xl:col-span-4 space-y-5">
            {/* Detected Classes Card */}
            <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 shadow-lg">
              <div className="flex items-center justify-between pb-3 border-b border-[#1B3554]">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#F8FAFC] flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#3B82F6]" />
                  <span>Detected Classes</span>
                </h4>
                <span className="text-[11px] text-[#94A3B8] font-mono">Frame 1,290</span>
              </div>

              <div className="divide-y divide-[#1B3554]/60 mt-3 text-xs">
                {/* Players */}
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-[#3B82F6]" />
                    <span className="font-semibold text-[#CBD5E1]">Players</span>
                  </div>
                  <span className="font-mono font-bold text-base text-[#3B82F6]">
                    {activeVideo.detections.players || 22}
                  </span>
                </div>

                {/* Ball */}
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-[#FBBF24]" />
                    <span className="font-semibold text-[#CBD5E1]">Ball</span>
                  </div>
                  <span className="font-mono font-bold text-base text-[#FBBF24]">
                    {activeVideo.detections.ball || 1}
                  </span>
                </div>

                {/* Goals */}
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-[#EF4444]" />
                    <span className="font-semibold text-[#CBD5E1]">Goals</span>
                  </div>
                  <span className="font-mono font-bold text-base text-[#EF4444]">
                    {activeVideo.detections.goals || 2}
                  </span>
                </div>

                {/* Referee */}
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-[#06B6D4]" />
                    <span className="font-semibold text-[#CBD5E1]">Referee</span>
                  </div>
                  <span className="font-mono font-bold text-base text-[#06B6D4]">
                    {activeVideo.detections.referee || 1}
                  </span>
                </div>
              </div>
            </div>

            {/* Model Confidence Card with Circular Visual */}
            <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 shadow-lg space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#1B3554]">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#F8FAFC]">
                  Model Confidence
                </h4>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#22C55E]/15 text-[#22C55E] font-bold">
                  HIGH PRECISION
                </span>
              </div>

              {/* Circular Ring Confidence Visual */}
              <div className="flex items-center justify-center py-2">
                <div className="relative w-36 h-36 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      fill="transparent"
                      stroke="#09162A"
                      strokeWidth="8"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      fill="transparent"
                      stroke="#0B5CFF"
                      strokeWidth="8"
                      strokeDasharray="264"
                      strokeDashoffset="21" // ~92%
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-2xl font-black text-[#F8FAFC]">
                      {activeVideo.modelConfidence || 94.2}%
                    </span>
                    <span className="text-[10px] text-[#94A3B8] font-medium">
                      Mean AP@50
                    </span>
                  </div>
                </div>
              </div>

              {/* Model Specifications */}
              <div className="space-y-2.5 text-xs pt-2 border-t border-[#1B3554]/60">
                <div className="flex items-center justify-between text-[#94A3B8]">
                  <span>Model:</span>
                  <span className="font-semibold text-[#CBD5E1]">YOLO Football Model</span>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[#94A3B8]">
                    <span>Confidence Threshold:</span>
                    <span className="font-mono font-bold text-[#3B82F6]">
                      {confidenceThreshold.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="0.9"
                    step="0.05"
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                    className="w-full accent-[#0B5CFF] h-1.5 bg-[#09162A] rounded-lg cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between text-[#94A3B8]">
                  <span>Frame Rate:</span>
                  <span className="font-mono font-bold text-[#CBD5E1]">30 FPS</span>
                </div>

                <div className="flex items-center justify-between text-[#94A3B8]">
                  <span>Processing Time:</span>
                  <span className="font-mono font-bold text-[#22C55E]">42s</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PLAYER TRACKING */}
      {activeVideoTab === 'tracking' && (
        <div className="space-y-4">
          <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-base font-bold text-[#F8FAFC]">
                  Tactical Player Tracking & Positional Matrix
                </h4>
                <p className="text-xs text-[#94A3B8]">
                  Computed 2D pitch coordinates mapped from YOLO bounding box centers.
                </p>
              </div>
              <span className="px-3 py-1 rounded-lg bg-[#0B5CFF]/20 text-[#3B82F6] text-xs font-mono font-bold border border-[#0B5CFF]/30">
                Homography Calibrated
              </span>
            </div>

            <FootballPitch
              mode="positions"
              networkNodes={teamStats.passNetworkNodes}
              heightClass="h-[460px]"
            />
          </div>
        </div>
      )}

      {/* TAB 3: HEATMAP */}
      {activeVideoTab === 'heatmap' && (
        <div className="space-y-4">
          <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-base font-bold text-[#F8FAFC]">
                  Pitch Territory & Activity Heatmap
                </h4>
                <p className="text-xs text-[#94A3B8]">
                  Spatial density of squad touches and pressing zones across 48 minutes.
                </p>
              </div>
            </div>

            <FootballPitch
              mode="heatmap"
              heatPoints={selectedPlayer.heatPoints}
              heightClass="h-[460px]"
              showLegend={true}
            />
          </div>
        </div>
      )}

      {/* TAB 4: PASS NETWORK */}
      {activeVideoTab === 'pass_network' && (
        <div className="space-y-4">
          <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-base font-bold text-[#F8FAFC]">
                  Squad Passing Network
                </h4>
                <p className="text-xs text-[#94A3B8]">
                  Node size reflects player touches; line thickness corresponds to passing volume.
                </p>
              </div>
              <div className="text-xs text-[#22C55E] font-bold font-mono">
                512 Completed Passes
              </div>
            </div>

            <FootballPitch
              mode="passing"
              networkNodes={teamStats.passNetworkNodes}
              networkLinks={teamStats.passNetworkLinks}
              heightClass="h-[460px]"
              showLegend={true}
            />
          </div>
        </div>
      )}

      {/* TAB 5: EVENTS */}
      {activeVideoTab === 'events' && (
        <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 shadow-lg space-y-4">
          <h4 className="text-base font-bold text-[#F8FAFC]">
            Detected Match Events
          </h4>
          <div className="divide-y divide-[#1B3554]/60">
            {events.map((ev) => (
              <div
                key={ev.id}
                onClick={() => setSelectedEvent(ev)}
                className="py-3 flex items-center justify-between hover:bg-[#0D203B] px-3 rounded-xl cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-bold text-[#3B82F6] bg-[#09162A] px-2 py-1 rounded border border-[#1B3554]">
                    {ev.time}
                  </span>
                  <div>
                    <span className="text-xs font-bold text-[#F8FAFC] block">
                      {ev.type} • Player #{ev.playerNumber} ({ev.playerName})
                    </span>
                    <span className="text-[11px] text-[#94A3B8]">{ev.details}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-[#22C55E]">
                    {ev.outcome}
                  </span>
                  <span className="text-xs text-[#3B82F6] hover:underline">
                    View Trajectory &rarr;
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 6: RAW DATA */}
      {activeVideoTab === 'raw' && (
        <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 shadow-lg space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-[#1B3554]">
            <h4 className="text-sm font-bold text-[#F8FAFC]">
              YOLO Detection Coordinates JSON Stream
            </h4>
            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(INITIAL_DETECTION_BOXES, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'yolo_detections_frame_1290.json';
                a.click();
              }}
              className="px-3 py-1.5 rounded-lg bg-[#0B5CFF] text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
          </div>
          <pre className="p-4 rounded-xl bg-[#061122] border border-[#1B3554] text-[#38BDF8] font-mono text-xs overflow-x-auto max-h-96">
            {JSON.stringify(INITIAL_DETECTION_BOXES, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
