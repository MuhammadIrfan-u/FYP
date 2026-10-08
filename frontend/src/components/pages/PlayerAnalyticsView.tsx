'use client';

import React from 'react';
import {
  Flame,
  Route,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { FootballPitch } from '@/components/common/FootballPitch';

export const PlayerAnalyticsView: React.FC = () => {
  const { players, selectedPlayer, setSelectedPlayer } = useFootball();

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* 1. TITLE & PLAYER SELECTOR HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl sm:text-2xl font-black text-[#242424] tracking-tight">
            Player Analytics
          </h3>
          <p className="text-xs sm:text-sm text-[#858585] mt-1">
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
                    ? 'bg-[#262626] text-white shadow-xs'
                    : 'bg-[#FAF8F4] hover:bg-[#FBFAF7] text-[#858585] hover:text-[#242424] border border-[#E8E3D8]'
                }`}
              >
                <span className="font-mono text-[#D9D3C5] font-semibold">#{p.number}</span>
                <span>{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. SELECTED PLAYER BIO BANNER */}
      <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          {/* Avatar with Jersey Number */}
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-[#262626] flex items-center justify-center text-white text-xl font-black shadow-xs border border-[#D9D3C5]">
              {selectedPlayer.avatar}
            </div>
            <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-full bg-[#FAF8F4] border border-[#E8E3D8] text-[10px] font-mono font-bold text-[#242424]">
              #{selectedPlayer.number}
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <h4 className="text-lg sm:text-xl font-bold text-[#242424]">
                #{selectedPlayer.number} {selectedPlayer.name}
              </h4>
              <span className="px-2 py-0.5 rounded-full bg-[#16A34A]/10 text-[#16A34A] text-xs font-semibold border border-[#16A34A]/30">
                Match Rating: {selectedPlayer.rating}
              </span>
            </div>
            <p className="text-xs text-[#858585] mt-1 font-medium">
              {selectedPlayer.position} • {selectedPlayer.role} • {selectedPlayer.team}
            </p>
          </div>
        </div>

        {/* Quick Physical Markers */}
        <div className="flex items-center gap-4 text-xs font-mono border-t sm:border-t-0 sm:border-l border-[#E8E3D8] pt-3 sm:pt-0 sm:pl-6">
          <div>
            <span className="text-[#858585] block text-[10px] uppercase font-sans font-bold">Minutes</span>
            <span className="text-sm font-bold text-[#242424]">{selectedPlayer.minutesPlayed}&apos;</span>
          </div>
          <div>
            <span className="text-[#858585] block text-[10px] uppercase font-sans font-bold">Sprints</span>
            <span className="text-sm font-bold text-[#2563EB]">{selectedPlayer.sprints}</span>
          </div>
          <div>
            <span className="text-[#858585] block text-[10px] uppercase font-sans font-bold">Stamina</span>
            <span className="text-sm font-bold text-[#16A34A]">{selectedPlayer.stamina}</span>
          </div>
        </div>
      </div>

      {/* 3. PLAYER STATISTICS CARDS ROW */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Distance Covered */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-2xs">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#858585] block">
            Distance Covered
          </span>
          <div className="text-2xl font-black text-[#242424] mt-2">
            {selectedPlayer.distanceCovered}
          </div>
          <span className="text-[11px] text-[#16A34A] font-semibold mt-1 block">
            +0.6 km vs avg
          </span>
        </div>

        {/* Top Speed */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-2xs">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#858585] block">
            Top Speed
          </span>
          <div className="text-2xl font-black text-[#D97706] mt-2">
            {selectedPlayer.topSpeed}
          </div>
          <span className="text-[11px] text-[#858585] mt-1 block font-medium">
            Peak at min 28&apos;
          </span>
        </div>

        {/* Pass Accuracy */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-2xs">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#858585] block">
            Pass Accuracy
          </span>
          <div className="text-2xl font-black text-[#242424] mt-2">
            {selectedPlayer.passAccuracy}
          </div>
          <span className="text-[11px] text-[#858585] font-mono mt-1 block font-medium">
            {selectedPlayer.passesCompleted}
          </span>
        </div>

        {/* Successful Dribbles */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-2xs">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#858585] block">
            Successful Dribbles
          </span>
          <div className="text-2xl font-black text-[#7C3AED] mt-2">
            {selectedPlayer.successfulDribbles}
          </div>
          <span className="text-[11px] text-[#16A34A] mt-1 block font-semibold">
            62.5% success
          </span>
        </div>

        {/* Shots on Target */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-2xs">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#858585] block">
            Shots on Target
          </span>
          <div className="text-2xl font-black text-[#DC2626] mt-2">
            {selectedPlayer.shotsOnTarget}
          </div>
          <span className="text-[11px] text-[#858585] mt-1 block font-medium">
            1 Key Goal Created
          </span>
        </div>
      </div>

      {/* 4. PITCH VISUALISATIONS: HEATMAP & MOVEMENT */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PLAYER HEATMAP */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-[#242424] flex items-center gap-2">
                <Flame className="w-4 h-4 text-[#DC2626]" />
                <span>Player Heatmap</span>
              </h4>
              <p className="text-xs text-[#858585]">
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
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-[#242424] flex items-center gap-2">
                <Route className="w-4 h-4 text-[#2563EB]" />
                <span>Player Movement</span>
              </h4>
              <p className="text-xs text-[#858585]">
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
      <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wider text-[#242424]">
              Match Activity & Physical Load Progression
            </h4>
            <p className="text-xs text-[#858585]">
              Distance covered, speed peaks, and passing accuracy broken down in 15-minute intervals.
            </p>
          </div>
          <span className="text-xs font-mono text-[#858585]">
            Full 90 Minutes Telemetry
          </span>
        </div>

        {/* Activity Intervals Bar Table */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {selectedPlayer.activityIntervals.map((act) => (
            <div
              key={act.interval}
              className="bg-[#FBFAF7] border border-[#E8E3D8] rounded-xl p-3.5 space-y-2 text-center"
            >
              <span className="text-xs font-bold text-[#242424] font-mono block">
                {act.interval}
              </span>

              {/* Mini visual bar */}
              <div className="h-20 w-full flex items-end justify-center gap-1.5 py-1">
                {/* Distance bar */}
                <div
                  className="w-3 rounded-t bg-[#262626]"
                  style={{ height: `${(act.distanceKm / 2.2) * 100}%` }}
                  title={`Distance: ${act.distanceKm} km`}
                />
                {/* Speed bar */}
                <div
                  className="w-3 rounded-t bg-[#D97706]"
                  style={{ height: `${(act.topSpeedKmH / 35) * 100}%` }}
                  title={`Top Speed: ${act.topSpeedKmH} km/h`}
                />
              </div>

              <div className="text-[11px] font-mono text-[#404040] pt-1 border-t border-[#E8E3D8]">
                <div className="flex justify-between text-[#858585]">
                  <span>Dist:</span>
                  <span className="text-[#242424] font-bold">{act.distanceKm}k</span>
                </div>
                <div className="flex justify-between text-[#858585]">
                  <span>Speed:</span>
                  <span className="text-[#D97706] font-bold">{act.topSpeedKmH}</span>
                </div>
                <div className="flex justify-between text-[#858585]">
                  <span>Pass:</span>
                  <span className="text-[#16A34A] font-bold">{act.passAcc}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
