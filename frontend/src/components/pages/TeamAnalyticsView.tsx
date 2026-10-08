'use client';

import React, { useState } from 'react';
import {
  Layers,
  Share2,
  Users,
  Flame,
  TrendingUp,
  Shield,
  Target,
  Compass,
  ArrowRight,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { FootballPitch } from '@/components/common/FootballPitch';

export const TeamAnalyticsView: React.FC = () => {
  const { teamStats, selectedPlayer } = useFootball();
  const [pitchMode, setPitchMode] = useState<'passing' | 'positions' | 'heatmap'>('passing');

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* 1. TITLE & FORMATION BADGE */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl sm:text-2xl font-black text-[#242424] tracking-tight">
            Team Analytics
          </h3>
          <p className="text-xs sm:text-sm text-[#858585] mt-1">
            Collective tactical positioning, passing network density, and territorial balance.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-[#EEEBE3] text-[#242424] border border-[#E8E3D8] font-mono text-xs font-bold">
            Formation: {teamStats.formation}
          </span>
        </div>
      </div>

      {/* 2. TEAM KPI METRICS CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Possession */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-[#858585] block">
            Possession
          </span>
          <div className="text-3xl font-black text-[#16A34A] mt-2">
            {teamStats.possession}%
          </div>
          <span className="text-[11px] text-[#16A34A] font-medium mt-1 block">
            Dominant field control
          </span>
        </div>

        {/* Pass Accuracy */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-[#858585] block">
            Pass Accuracy
          </span>
          <div className="text-3xl font-black text-[#242424] mt-2">
            {teamStats.passAccuracy}%
          </div>
          <span className="text-[11px] text-[#858585] font-mono mt-1 block">
            {teamStats.passesCompleted}
          </span>
        </div>

        {/* Total Shots */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-[#858585] block">
            Shots
          </span>
          <div className="text-3xl font-black text-[#242424] mt-2">
            {teamStats.shots}
          </div>
          <span className="text-[11px] text-[#858585] mt-1 block">
            xG 2.14 generated
          </span>
        </div>

        {/* Shots on Target */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-[#858585] block">
            Shots on Target
          </span>
          <div className="text-3xl font-black text-[#242424] mt-2">
            {teamStats.shotsOnTarget}
          </div>
          <span className="text-[11px] text-[#16A34A] font-medium mt-1 block">
            50% on-target ratio
          </span>
        </div>

        {/* Distance Covered */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-sm col-span-2 sm:col-span-1">
          <span className="text-xs font-medium uppercase tracking-wider text-[#858585] block">
            Distance Covered
          </span>
          <div className="text-3xl font-black text-[#242424] mt-2">
            {teamStats.distanceCovered}
          </div>
          <span className="text-[11px] text-[#858585] mt-1 block">
            Full squad cumulative
          </span>
        </div>
      </div>

      {/* 3. TACTICAL PITCH SUITE (PASSING NETWORK / POSITIONING / HEATMAP) */}
      <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E8E3D8]">
          <div>
            <h4 className="text-base font-bold text-[#242424]">
              Tactical Pitch Matrix
            </h4>
            <p className="text-xs text-[#858585]">
              Switch between passing network, average positioning, and collective team heatmap.
            </p>
          </div>

          {/* Mode Switcher Buttons */}
          <div className="flex items-center bg-[#EEEBE3] border border-[#E8E3D8] rounded-xl p-1 text-xs">
            <button
              onClick={() => setPitchMode('passing')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                pitchMode === 'passing'
                  ? 'bg-[#262626] text-white shadow-sm'
                  : 'text-[#858585] hover:text-[#242424]'
              }`}
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Passing Network</span>
            </button>

            <button
              onClick={() => setPitchMode('positions')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                pitchMode === 'positions'
                  ? 'bg-[#262626] text-white shadow-sm'
                  : 'text-[#858585] hover:text-[#242424]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Team Positioning</span>
            </button>

            <button
              onClick={() => setPitchMode('heatmap')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                pitchMode === 'heatmap'
                  ? 'bg-[#262626] text-white shadow-sm'
                  : 'text-[#858585] hover:text-[#242424]'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Team Heatmap</span>
            </button>
          </div>
        </div>

        {/* Pitch Render */}
        <FootballPitch
          mode={pitchMode}
          networkNodes={teamStats.passNetworkNodes}
          networkLinks={teamStats.passNetworkLinks}
          heatPoints={selectedPlayer.heatPoints}
          heightClass="h-[460px]"
          showLegend={true}
        />
      </div>

      {/* 4. ATTACKING & DEFENSIVE ZONES + POSSESSION TREND */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attacking Zones */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424]">
              Attacking Zones
            </h4>
            <span className="text-xs text-[#242424] font-bold">14 Shots</span>
          </div>

          <p className="text-xs text-[#858585]">
            Final-third offensive penetration breakdown by lateral channel.
          </p>

          <div className="grid grid-cols-3 gap-2 text-center py-2">
            <div className="bg-[#FBFAF7] border border-[#E8E3D8] rounded-xl p-3">
              <span className="text-[10px] uppercase font-bold text-[#858585] block">Left Flank</span>
              <span className="text-xl font-black text-[#242424] mt-1 block">
                {teamStats.attackingZones.left}%
              </span>
              <span className="text-[10px] text-[#858585]">Silva #7</span>
            </div>

            <div className="bg-[#FBFAF7] border-2 border-[#262626] rounded-xl p-3 shadow-sm">
              <span className="text-[10px] uppercase font-bold text-[#242424] block">Centre Channel</span>
              <span className="text-xl font-black text-[#16A34A] mt-1 block">
                {teamStats.attackingZones.center}%
              </span>
              <span className="text-[10px] font-bold text-[#16A34A]">Primary Threat</span>
            </div>

            <div className="bg-[#FBFAF7] border border-[#E8E3D8] rounded-xl p-3">
              <span className="text-[10px] uppercase font-bold text-[#858585] block">Right Flank</span>
              <span className="text-xl font-black text-[#242424] mt-1 block">
                {teamStats.attackingZones.right}%
              </span>
              <span className="text-[10px] text-[#858585]">Vance #11</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#EEEBE3] text-xs text-[#404040] border border-[#E8E3D8]">
            <strong className="text-[#242424]">Coaching Note: </strong>
            Right channel underutilized (18%). Switching play through Lucas Fernandes #8 can stretch low defensive blocks.
          </div>
        </div>

        {/* Defensive Zones */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424]">
              Defensive Structure
            </h4>
            <span className="text-xs text-[#16A34A] font-bold">Clean Sheet</span>
          </div>

          <p className="text-xs text-[#858585]">
            Proportion of defensive actions won across the pitch depths.
          </p>

          <div className="space-y-3 pt-1">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#404040] font-semibold">High Press (Opp. Half)</span>
                <span className="font-mono font-bold text-[#2563EB]">
                  {teamStats.defensiveZones.highPress}%
                </span>
              </div>
              <div className="w-full h-2 bg-[#EEEBE3] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#2563EB] rounded-full"
                  style={{ width: `${teamStats.defensiveZones.highPress}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#404040] font-semibold">Mid Block (Centre Line)</span>
                <span className="font-mono font-bold text-[#16A34A]">
                  {teamStats.defensiveZones.midBlock}%
                </span>
              </div>
              <div className="w-full h-2 bg-[#EEEBE3] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#16A34A] rounded-full"
                  style={{ width: `${teamStats.defensiveZones.midBlock}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#404040] font-semibold">Deep Defending (Box)</span>
                <span className="font-mono font-bold text-[#D97706]">
                  {teamStats.defensiveZones.deepDefending}%
                </span>
              </div>
              <div className="w-full h-2 bg-[#EEEBE3] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#D97706] rounded-full"
                  style={{ width: `${teamStats.defensiveZones.deepDefending}%` }}
                />
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#EEEBE3] text-xs text-[#404040] border border-[#E8E3D8]">
            <strong className="text-[#242424]">Pressing Metric: </strong>
            Average recovery time after turnover is 4.8s. 8.4 PPDA intensity.
          </div>
        </div>

        {/* Possession Trend Timeline */}
        <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424]">
              Possession Trend
            </h4>
            <span className="text-xs text-[#242424] font-mono font-bold">15m Segments</span>
          </div>

          <p className="text-xs text-[#858585]">
            Possession split between FC Dynamo (Charcoal) and Rapid Stars (Soft Cream).
          </p>

          <div className="space-y-2.5 py-1">
            {teamStats.possessionTimeline.map((item) => (
              <div key={item.minute} className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-[#858585] font-bold">{item.minute}</span>
                  <div className="flex gap-2">
                    <span className="text-[#242424] font-bold">{item.dynamo}%</span>
                    <span className="text-[#858585]">{item.rapid}%</span>
                  </div>
                </div>
                <div className="w-full h-2 bg-[#EEEBE3] rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-[#262626]"
                    style={{ width: `${item.dynamo}%` }}
                  />
                  <div
                    className="h-full bg-[#D9D3C5]"
                    style={{ width: `${item.rapid}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
