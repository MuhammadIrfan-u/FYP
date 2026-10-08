'use client';

import React from 'react';
import {
  Cpu,
  Flame,
  Share2,
  Activity,
  Code,
  Film,
  Download,
  Crosshair,
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
    <div className="space-y-10 animate-in fade-in duration-200">
      {/* 1. PAGE TITLE */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-[#E8E3D8]">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-black text-[#242424] tracking-tight">
              Analysis Results
            </h1>
            <StatusBadge status={activeVideo.status} size="sm" />
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-[#858585]">
            <span className="text-[#242424] font-semibold">{activeVideo.matchName}</span>
            <span>•</span>
            <span className="font-mono">{activeVideo.filename}</span>
            <span>•</span>
            <span>{activeVideo.date}</span>
            <span>•</span>
            <span>{activeVideo.duration}</span>
          </div>
        </div>

        <div className="px-3 py-1.5 rounded-lg bg-[#FAF8F4] border border-[#E8E3D8] text-xs text-[#404040] flex items-center gap-2 self-start md:self-auto">
          <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
          <span>YOLOv11 pipeline · 100% processed</span>
        </div>
      </div>

      {/* 2. SUB-NAVIGATION TABS */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-[#E8E3D8]">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeVideoTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveVideoTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-[#262626] text-white shadow-xs'
                  : 'text-[#858585] hover:text-[#242424] hover:bg-[#EEEBE3]'
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
        <div className="space-y-10">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          {/* Left: Large Video Player with Computer Vision Overlays */}
          <div className="xl:col-span-8 space-y-4">
            <TacticalVideoPlayer
              imageSrc={activeVideo.thumbnail || '/match_tactical_frame.jpg'}
              matchName={activeVideo.matchName}
              duration={activeVideo.duration}
              confidenceThreshold={confidenceThreshold}
              showTimeline={true}
            />
          </div>

          {/* Right: Detected Classes & Model Confidence */}
          <div className="xl:col-span-4 space-y-5">
            {/* Detected Classes Card */}
            <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-2xs">
              <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424] flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#262626]" />
                  <span>Detected Classes</span>
                </h4>
                <span className="text-[11px] text-[#858585] font-mono">Frame 1,290</span>
              </div>

              <div className="divide-y divide-[#E8E3D8] mt-3 text-xs">
                {/* Players */}
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-[#2563EB]" />
                    <span className="font-semibold text-[#404040]">Players</span>
                  </div>
                  <span className="font-mono font-extrabold text-base text-[#2563EB]">
                    {activeVideo.detections.players || 22}
                  </span>
                </div>

                {/* Ball */}
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-[#D97706]" />
                    <span className="font-semibold text-[#404040]">Ball</span>
                  </div>
                  <span className="font-mono font-extrabold text-base text-[#D97706]">
                    {activeVideo.detections.ball || 1}
                  </span>
                </div>

                {/* Goals */}
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-[#DC2626]" />
                    <span className="font-semibold text-[#404040]">Goals</span>
                  </div>
                  <span className="font-mono font-extrabold text-base text-[#DC2626]">
                    {activeVideo.detections.goals || 2}
                  </span>
                </div>

                {/* Referee */}
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-[#555555]" />
                    <span className="font-semibold text-[#404040]">Referee</span>
                  </div>
                  <span className="font-mono font-extrabold text-base text-[#555555]">
                    {activeVideo.detections.referee || 1}
                  </span>
                </div>
              </div>
            </div>

            {/* Model Confidence Card with Circular Visual */}
            <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424]">
                  Model Confidence
                </h4>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#16A34A]/10 text-[#16A34A] font-bold border border-[#16A34A]/30">
                  HIGH PRECISION
                </span>
              </div>

              {/* Circular Ring Confidence Visual in charcoal */}
              <div className="flex items-center justify-center py-2">
                <div className="relative w-36 h-36 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      fill="transparent"
                      stroke="#E8E3D8"
                      strokeWidth="8"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      fill="transparent"
                      stroke="#262626"
                      strokeWidth="8"
                      strokeDasharray="264"
                      strokeDashoffset="21"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-2xl font-black text-[#242424]">
                      {activeVideo.modelConfidence || 94.2}%
                    </span>
                    <span className="text-[10px] text-[#858585] font-semibold">
                      Mean AP@50
                    </span>
                  </div>
                </div>
              </div>

              {/* Model Specifications */}
              <div className="space-y-2.5 text-xs pt-2 border-t border-[#E8E3D8]">
                <div className="flex items-center justify-between text-[#858585]">
                  <span>Model:</span>
                  <span className="font-semibold text-[#242424]">YOLO Football Model</span>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[#858585]">
                    <span>Confidence Threshold:</span>
                    <span className="font-mono font-bold text-[#262626]">
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
                    className="w-full accent-[#262626] h-1.5 bg-[#E8E3D8] rounded-lg cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between text-[#858585]">
                  <span>Frame Rate:</span>
                  <span className="font-mono font-bold text-[#242424]">30 FPS</span>
                </div>

                <div className="flex items-center justify-between text-[#858585]">
                  <span>Processing Time:</span>
                  <span className="font-mono font-bold text-[#16A34A]">42s</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Key match metrics (displayed at the end) */}
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#858585] whitespace-nowrap">
              Key Match Metrics
            </span>
            <div className="flex-1 h-px bg-[#E8E3D8]" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { label: 'Ball Retention', value: '58%', color: 'text-[#16A34A]' },
              { label: 'Field Tilt (Offense)', value: '64.2%', color: 'text-[#2563EB]' },
              { label: 'Expected Goals (xG)', value: '2.14', color: 'text-[#D97706]' },
              { label: 'Counter-Press Time', value: '4.8s', color: 'text-[#7C3AED]' },
            ].map((m) => (
              <div key={m.label} className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-xl p-5">
                <span className="text-xs text-[#858585] font-medium block">{m.label}</span>
                <span className={`text-2xl font-extrabold mt-1 block ${m.color}`}>{m.value}</span>
              </div>
            ))}
          </div>
        </div>
        </div>
      )}
      {activeVideoTab === 'tracking' && (
        <div className="space-y-4">
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-base font-bold text-[#242424]">
                  Tactical Player Tracking & Positional Matrix
                </h4>
                <p className="text-xs text-[#858585]">
                  Computed 2D pitch coordinates mapped from YOLO bounding box centers.
                </p>
              </div>
              <span className="px-3 py-1 rounded-lg bg-[#EEEBE3] text-[#242424] text-xs font-mono font-bold border border-[#D9D3C5]">
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
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-base font-bold text-[#242424]">
                  Pitch Territory & Activity Heatmap
                </h4>
                <p className="text-xs text-[#858585]">
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
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-base font-bold text-[#242424]">
                  Squad Passing Network
                </h4>
                <p className="text-xs text-[#858585]">
                  Node size reflects player touches; line thickness corresponds to passing volume.
                </p>
              </div>
              <div className="text-xs text-[#16A34A] font-bold font-mono">
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
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm space-y-4">
          <h4 className="text-base font-bold text-[#242424]">
            Detected Match Events
          </h4>
          <div className="divide-y divide-[#E8E3D8]">
            {events.map((ev) => (
              <div
                key={ev.id}
                onClick={() => setSelectedEvent(ev)}
                className="py-3 flex items-center justify-between hover:bg-[#FBFAF7] px-3 rounded-xl cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-bold text-[#242424] bg-[#EEEBE3] px-2 py-1 rounded border border-[#E8E3D8]">
                    {ev.time}
                  </span>
                  <div>
                    <span className="text-xs font-bold text-[#242424] block">
                      {ev.type} • Player #{ev.playerNumber} ({ev.playerName})
                    </span>
                    <span className="text-[11px] text-[#858585]">{ev.details}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-[#16A34A]">
                    {ev.outcome}
                  </span>
                  <span className="text-xs text-[#2563EB] hover:underline font-semibold">
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
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
            <h4 className="text-sm font-bold text-[#242424]">
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
              className="px-3 py-1.5 rounded-lg bg-[#262626] hover:bg-[#171717] text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
          </div>
          <pre className="p-4 rounded-xl bg-[#FBFAF7] border border-[#E8E3D8] text-[#404040] font-mono text-xs overflow-x-auto max-h-96">
            {JSON.stringify(INITIAL_DETECTION_BOXES, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
