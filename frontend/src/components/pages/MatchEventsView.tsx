'use client';

import React, { useState } from 'react';
import {
  Activity,
  Play,
  ArrowRight,
  Filter,
  CheckCircle2,
  Clock,
  Sparkles,
  Target,
  Zap,
  TrendingUp,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { FootballPitch } from '@/components/common/FootballPitch';
import { Modal } from '@/components/common/Modal';
import { MatchEvent } from '@/types/football';

export const MatchEventsView: React.FC = () => {
  const { events, selectedEvent, setSelectedEvent, activeVideo } = useFootball();
  const [filterType, setFilterType] = useState<string>('All');

  const filteredEvents = events.filter((ev) => {
    if (filterType === 'All') return true;
    return ev.type.toLowerCase() === filterType.toLowerCase();
  });

  const getEventBadgeStyle = (type: string) => {
    switch (type.toLowerCase()) {
      case 'goal':
        return 'bg-[#DC2626]/10 text-[#DC2626] border-[#DC2626]/20';
      case 'pass':
        return 'bg-[#2563EB]/10 text-[#2563EB] border-[#2563EB]/20';
      case 'shot':
        return 'bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20';
      case 'dribble':
        return 'bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/20';
      case 'sprint':
        return 'bg-[#0891B2]/10 text-[#0891B2] border-[#0891B2]/20';
      default:
        return 'bg-[#EEEBE3] text-[#404040] border-[#E8E3D8]';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. TITLE & EVENT FILTERS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl sm:text-2xl font-black text-[#242424] tracking-tight">
            Match Events
          </h3>
          <p className="text-xs sm:text-sm text-[#858585] mt-1">
            Chronological computer vision event log with 2D pitch trajectories.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {['All', 'Pass', 'Dribble', 'Shot', 'Sprint', 'Goal'].map((f) => (
            <button
              key={f}
              onClick={() => setFilterType(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filterType === f
                  ? 'bg-[#262626] text-white shadow-sm'
                  : 'bg-[#FBFAF7] hover:bg-[#EEEBE3] text-[#404040] border border-[#E8E3D8]'
              }`}
            >
              {f === 'All' ? 'All Events' : `${f}s`}
            </button>
          ))}
        </div>
      </div>

      {/* 2. CHRONOLOGICAL EVENT TIMELINE CARDS */}
      <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
          <span className="text-xs font-bold uppercase tracking-wider text-[#858585]">
            Timeline Log ({filteredEvents.length} detected)
          </span>
          <span className="text-[11px] text-[#858585] font-mono">
            Click any event to inspect trajectory
          </span>
        </div>

        <div className="divide-y divide-[#E8E3D8]">
          {filteredEvents.map((ev) => {
            const badgeStyle = getEventBadgeStyle(ev.type);
            return (
              <div
                key={ev.id}
                onClick={() => setSelectedEvent(ev)}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F7F4EE] p-3 rounded-xl cursor-pointer transition-colors group"
              >
                {/* Left: Time & Type & Player */}
                <div className="flex items-center gap-3.5">
                  <div className="px-2.5 py-1 rounded-lg bg-[#EEEBE3] border border-[#E8E3D8] font-mono text-xs font-bold text-[#242424] shrink-0">
                    {ev.time}
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full border text-[11px] font-bold tracking-wide uppercase shrink-0 ${badgeStyle}`}
                  >
                    {ev.type}
                  </span>

                  <div>
                    <h5 className="text-xs sm:text-sm font-bold text-[#242424] group-hover:text-[#171717] transition-colors">
                      Player #{ev.playerNumber} • {ev.playerName}
                    </h5>
                    <p className="text-[11px] text-[#858585] line-clamp-1">
                      {ev.details}
                    </p>
                  </div>
                </div>

                {/* Right: Outcome & Detail Link */}
                <div className="flex items-center justify-between sm:justify-end gap-4 pl-12 sm:pl-0">
                  <span className="text-xs font-bold font-mono text-[#16A34A]">
                    {ev.outcome}
                  </span>

                  <button className="px-3 py-1 rounded-lg bg-[#FBFAF7] group-hover:bg-[#262626] border border-[#E8E3D8] group-hover:border-[#262626] text-[#404040] group-hover:text-white text-xs font-semibold flex items-center gap-1 transition-all">
                    <span>Inspect</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. EVENT DETAIL MODAL */}
      <Modal
        isOpen={selectedEvent !== null}
        onClose={() => setSelectedEvent(null)}
        title={selectedEvent ? `Event Detail: ${selectedEvent.type} at ${selectedEvent.time}` : 'Event Detail'}
        subtitle={selectedEvent?.details}
        maxWidth="max-w-3xl"
      >
        {selectedEvent && (
          <div className="space-y-6">
            {/* Metadata Summary Pill */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#FBFAF7] border border-[#E8E3D8] rounded-xl p-3.5 text-xs">
              <div>
                <span className="text-[#858585] block text-[10px] uppercase">Timestamp</span>
                <span className="font-mono font-bold text-[#242424] text-sm">
                  {selectedEvent.time}
                </span>
              </div>
              <div>
                <span className="text-[#858585] block text-[10px] uppercase">Player Involved</span>
                <span className="font-bold text-[#242424] text-sm">
                  #{selectedEvent.playerNumber} {selectedEvent.playerName}
                </span>
              </div>
              <div>
                <span className="text-[#858585] block text-[10px] uppercase">Event Class</span>
                <span className="font-bold text-[#D97706] text-sm">
                  {selectedEvent.type}
                </span>
              </div>
              <div>
                <span className="text-[#858585] block text-[10px] uppercase">Result Outcome</span>
                <span className="font-bold text-[#16A34A] text-sm">
                  {selectedEvent.outcome}
                </span>
              </div>
            </div>

            {/* Visual Pass Trajectory on Pitch */}
            {selectedEvent.passTrajectory && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424] flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-[#16A34A]" />
                    <span>Pitch Trajectory Vector</span>
                  </h4>
                  <span className="text-xs font-mono font-bold text-[#16A34A]">
                    Distance: {selectedEvent.passTrajectory.distanceMeters.toFixed(1)} m
                  </span>
                </div>

                <FootballPitch
                  mode="trajectory"
                  trajectory={selectedEvent.passTrajectory}
                  heightClass="h-[320px]"
                  showLegend={false}
                />
              </div>
            )}

            {/* Video Broadcast Frame Clip Simulation */}
            <div className="relative aspect-video rounded-xl overflow-hidden border border-[#E8E3D8] bg-[#020E1D]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/match_tactical_frame.jpg"
                alt="Event Frame"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 p-4 flex flex-col justify-between">
                <div className="flex justify-between items-center text-xs">
                  <span className="px-2 py-0.5 rounded bg-[#262626] text-white font-mono font-bold">
                    FRAME @ {selectedEvent.time}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-black/70 text-[#D9D3C5] font-mono">
                    YOLO Track ID: #1024
                  </span>
                </div>
                <div className="text-xs text-white">
                  <span className="font-bold text-[#FBBF24] block">Tactical Context:</span>
                  <p className="text-[#E8E3D8] text-[11px] mt-0.5">
                    {selectedEvent.details}. Receiver initiated forward separation with 0.8s reaction delta.
                  </p>
                </div>
              </div>
            </div>

            {/* Close / Action Footer */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 rounded-xl bg-[#EEEBE3] hover:bg-[#E8E3D8] border border-[#E8E3D8] text-xs font-semibold text-[#242424] transition-colors"
              >
                Close View
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
