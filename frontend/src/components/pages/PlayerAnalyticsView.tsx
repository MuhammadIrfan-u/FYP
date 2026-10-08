'use client';

import React from 'react';
import {
  Users,
  Gauge,
  Target,
  Zap,
  Activity,
  Award,
  Flame,
  Route,
  TrendingUp,
  BarChart2,
  ChevronDown,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { FootballPitch } from '@/components/common/FootballPitch';
import { KpiCard } from '@/components/common/KpiCard';

export const PlayerAnalyticsView: React.FC = () => {
  const { players, selectedPlayer, setSelectedPlayer } = useFootball();

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* 1. TITLE & PLAYER SELECTOR HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl sm:text-2xl font-black text-[#F8FAFC] tracking-tight">
            Player Analytics
          </h3>
          <p className="text-xs sm:text-sm text-[#94A3B8] mt-1">
            Track individual performance, tactical movement, and spatial intensity.
          </p>
        </div>

        {/* Player Selector Bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {players.map((p) => {
            const isSelected = selectedPlayer.id === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedPlayer(p)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 ${
                  isSelected
                    ? 'bg-[#0B5CFF] text-white shadow-lg shadow-blue-500/30'
                    : 'bg-[#0D1D35] hover:bg-[#0D203B] text-[#94A3B8] border border-[#1B3554]'
                }`}
              >
                <span className="font-mono text-[#38BDF8]">#{p.number}</span>
                <span>{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. SELECTED PLAYER BIO BANNER */}
      <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          {/* Avatar with Jersey Number */}
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#0B5CFF] to-[#3B82F6] flex items-center justify-center text-white text-xl font-black shadow-lg shadow-blue-500/25 border border-white/20">
              {selectedPlayer.avatar}
            </div>
            <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-full bg-[#061122] border border-[#1B3554] text-[10px] font-mono font-bold text-[#3B82F6]">
              #{selectedPlayer.number}
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <h4 className="text-lg sm:text-xl font-bold text-[#F8FAFC]">
                #{selectedPlayer.number} {selectedPlayer.name}
              </h4>
              <span className="px-2 py-0.5 rounded-full bg-[#22C55E]/15 text-[#22C55E] text-xs font-semibold border border-[#22C55E]/30">
                Match Rating: {selectedPlayer.rating}
              </span>
            </div>
            <p className="text-xs text-[#94A3B8] mt-1 font-medium">
              {selectedPlayer.position} • {selectedPlayer.role} • {selectedPlayer.team}
            </p>
          </div>
        </div>

        {/* Quick Physical Markers */}
        <div className="flex items-center gap-4 text-xs font-mono border-t sm:border-t-0 sm:border-l border-[#1B3554]/70 pt-3 sm:pt-0 sm:pl-6">
          <div>
            <span className="text-[#64748B] block text-[10px] uppercase">Minutes</span>
            <span className="text-sm font-bold text-white">{selectedPlayer.minutesPlayed}&apos;</span>
          </div>
          <div>
            <span className="text-[#64748B] block text-[10px] uppercase">Sprints</span>
            <span className="text-sm font-bold text-[#06B6D4]">{selectedPlayer.sprints}</span>
          </div>
          <div>
            <span className="text-[#64748B] block text-[10px] uppercase">Stamina</span>
            <span className="text-sm font-bold text-[#22C55E]">{selectedPlayer.stamina}</span>
          </div>
        </div>
      </div>

      {/* 3. PLAYER STATISTICS CARDS ROW */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Distance Covered */}
        <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-4 shadow-lg">
          <span className="text-xs font-medium uppercase tracking-wider text-[#94A3B8] block">
            Distance Covered
          </span>
          <div className="text-2xl font-black text-[#F8FAFC] mt-2">
            {selectedPlayer.distanceCovered}
          </div>
          <span className="text-[11px] text-[#22C55E] font-semibold mt-1 block">
            +0.6 km vs avg
          </span>
        </div>

        {/* Top Speed */}
        <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-4 shadow-lg">
          <span className="text-xs font-medium uppercase tracking-wider text-[#94A3B8] block">
            Top Speed
          </span>
          <div className="text-2xl font-black text-[#FBBF24] mt-2">
            {selectedPlayer.topSpeed}
          </div>
          <span className="text-[11px] text-[#94A3B8] mt-1 block">
            Peak at min 28&apos;
          </span>
        </div>

        {/* Pass Accuracy */}
        <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-4 shadow-lg">
          <span className="text-xs font-medium uppercase tracking-wider text-[#94A3B8] block">
            Pass Accuracy
          </span>
          <div className="text-2xl font-black text-[#3B82F6] mt-2">
            {selectedPlayer.passAccuracy}
          </div>
          <span className="text-[11px] text-[#94A3B8] font-mono mt-1 block">
            {selectedPlayer.passesCompleted}
          </span>
        </div>

        {/* Successful Dribbles */}
        <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-4 shadow-lg">
          <span className="text-xs font-medium uppercase tracking-wider text-[#94A3B8] block">
            Successful Dribbles
          </span>
          <div className="text-2xl font-black text-[#8B5CF6] mt-2">
            {selectedPlayer.successfulDribbles}
          </div>
          <span className="text-[11px] text-[#22C55E] mt-1 block">
            62.5% success
          </span>
        </div>

        {/* Shots on Target */}
        <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-4 shadow-lg">
          <span className="text-xs font-medium uppercase tracking-wider text-[#94A3B8] block">
            Shots on Target
          </span>
          <div className="text-2xl font-black text-[#EF4444] mt-2">
            {selectedPlayer.shotsOnTarget}
          </div>
          <span className="text-[11px] text-[#94A3B8] mt-1 block">
            1 Key Goal Created
          </span>
        </div>
      </div>

      {/* 4. PITCH VISUALISATIONS: HEATMAP & MOVEMENT */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PLAYER HEATMAP */}
        <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#1B3554]">
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-[#F8FAFC] flex items-center gap-2">
                <Flame className="w-4 h-4 text-[#EF4444]" />
                <span>Player Heatmap</span>
              </h4>
              <p className="text-xs text-[#94A3B8]">
                Spatial density and territorial occupation for #{selectedPlayer.number} {selectedPlayer.name}.
              </p>
            </div>
          </div>

          <FootballPitch
            mode="heatmap"
            heatPoints={selectedPlayer.heatPoints}
            heightClass="h-[380px]"
            showLegend={true}
          />
        </div>

        {/* PLAYER MOVEMENT */}
        <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#1B3554]">
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-[#F8FAFC] flex items-center gap-2">
                <Route className="w-4 h-4 text-[#3B82F6]" />
                <span>Player Movement</span>
              </h4>
              <p className="text-xs text-[#94A3B8]">
                Sprint trajectories, recovery runs, and ball touch waypoints.
              </p>
            </div>
          </div>

          <FootballPitch
            mode="movement"
            movementSteps={selectedPlayer.movementPath}
            heightClass="h-[380px]"
            showLegend={true}
          />
        </div>
      </div>

      {/* 5. DETAILED INTERVAL CHARTS */}
      <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 sm:p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#1B3554]">
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wider text-[#F8FAFC]">
              Match Activity & Physical Load Progression
            </h4>
            <p className="text-xs text-[#94A3B8]">
              Distance covered, speed peaks, and passing accuracy broken down in 15-minute intervals.
            </p>
          </div>
          <span className="text-xs font-mono text-[#38BDF8]">
            Full 90 Minutes Telemetry
          </span>
        </div>

        {/* Activity Intervals Bar Table */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {selectedPlayer.activityIntervals.map((act) => (
            <div
              key={act.interval}
              className="bg-[#09162A] border border-[#1B3554] rounded-xl p-3.5 space-y-2 text-center"
            >
              <span className="text-xs font-bold text-[#3B82F6] font-mono block">
                {act.interval}
              </span>

              {/* Mini visual bar */}
              <div className="h-20 w-full flex items-end justify-center gap-1.5 py-1">
                {/* Distance bar */}
                <div
                  className="w-3 rounded-t bg-[#0B5CFF]"
                  style={{ height: `${(act.distanceKm / 2.2) * 100}%` }}
                  title={`Distance: ${act.distanceKm} km`}
                />
                {/* Speed bar */}
                <div
                  className="w-3 rounded-t bg-[#FBBF24]"
                  style={{ height: `${(act.topSpeedKmH / 35) * 100}%` }}
                  title={`Top Speed: ${act.topSpeedKmH} km/h`}
                />
              </div>

              <div className="text-[11px] font-mono text-[#CBD5E1] pt-1 border-t border-[#1B3554]/50">
                <div className="flex justify-between text-[#94A3B8]">
                  <span>Dist:</span>
                  <span className="text-white font-bold">{act.distanceKm}k</span>
                </div>
                <div className="flex justify-between text-[#94A3B8]">
                  <span>Speed:</span>
                  <span className="text-[#FBBF24] font-bold">{act.topSpeedKmH}</span>
                </div>
                <div className="flex justify-between text-[#94A3B8]">
                  <span>Pass:</span>
                  <span className="text-[#22C55E] font-bold">{act.passAcc}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
