'use client';

import React from 'react';
import {
  Calendar,
  Target,
  Trophy,
  Clock,
  UploadCloud,
  Dumbbell,
  Users,
  Cpu,
  ArrowRight,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { KpiCard } from '@/components/common/KpiCard';
import { TacticalVideoPlayer } from '@/components/common/TacticalVideoPlayer';

export const DashboardView: React.FC = () => {
  const { setActivePage, activeVideo } = useFootball();

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* 1. KPI CARDS ROW */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        <KpiCard
          title="Total Sessions"
          value="12"
          icon={Calendar}
          change="+3 sessions"
          isPositive={true}
          supportingText="vs. last month"
          accentColor="blue"
        />

        <KpiCard
          title="Avg. Pass Accuracy"
          value="78%"
          icon={Target}
          change="+4.2%"
          isPositive={true}
          supportingText="possession benchmark"
          accentColor="green"
        />

        <KpiCard
          title="Goals Scored"
          value="18"
          icon={Trophy}
          change="1.5 / match"
          isPositive={true}
          supportingText="12 matches recorded"
          accentColor="yellow"
        />

        <KpiCard
          title="Training Time"
          value="32 hrs"
          icon={Clock}
          change="+8 hrs"
          isPositive={true}
          supportingText="active squad load"
          accentColor="purple"
        />
      </section>

      {/* 2. RECENT ANALYSIS MAIN SECTION */}
      <section className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 sm:p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E8E3D8]">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#262626]" />
              <h3 className="text-base sm:text-lg font-bold text-[#242424] tracking-tight uppercase">
                Recent Analysis
              </h3>
            </div>
            <p className="text-xs text-[#858585] mt-0.5">
              Live YOLOv11 Computer Vision detection playback & squad metrics.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActivePage('analysis')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#262626] hover:bg-[#171717] text-white text-xs font-semibold shadow-xs transition-all"
            >
              <Cpu className="w-4 h-4" />
              <span>Open Detailed Studio</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Large Football Video Card with YOLO Overlay */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Video Player (Large) */}
          <div className="xl:col-span-8">
            <TacticalVideoPlayer
              imageSrc={activeVideo.thumbnail || '/match_tactical_frame.jpg'}
              matchName={activeVideo.matchName}
              duration={activeVideo.duration}
              confidenceThreshold={0.25}
              showTimeline={true}
            />
          </div>

          {/* Key Analysis Metrics Sidebar Beside Video */}
          <div className="xl:col-span-4 flex flex-col gap-4">
            <div className="bg-[#FBFAF7] border border-[#E8E3D8] rounded-2xl p-5 shadow-2xs">
              <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
                <span className="text-xs font-bold uppercase tracking-wider text-[#858585]">
                  Detection Telemetry
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#16A34A]/10 text-[#16A34A] border border-[#16A34A]/30 font-semibold">
                  Model Conf: 94.2%
                </span>
              </div>

              {/* Detections & Event Metrics Grid */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                {/* Players Detected */}
                <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-xl p-3 flex flex-col justify-between">
                  <span className="text-[11px] text-[#858585] font-medium">
                    Players Detected
                  </span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-black text-[#242424]">
                      {activeVideo.detections.players || 22}
                    </span>
                    <span className="text-[10px] text-[#858585]">active</span>
                  </div>
                </div>

                {/* Passes */}
                <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-xl p-3 flex flex-col justify-between">
                  <span className="text-[11px] text-[#858585] font-medium">
                    Passes Detected
                  </span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-black text-[#16A34A]">
                      {activeVideo.metrics.passes || 342}
                    </span>
                    <span className="text-[10px] text-[#16A34A]">84% acc</span>
                  </div>
                </div>

                {/* Shots */}
                <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-xl p-3 flex flex-col justify-between">
                  <span className="text-[11px] text-[#858585] font-medium">
                    Shots on Goal
                  </span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-black text-[#D97706]">
                      {activeVideo.metrics.shots || 14}
                    </span>
                    <span className="text-[10px] text-[#D97706]">7 on tgt</span>
                  </div>
                </div>

                {/* Dribbles */}
                <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-xl p-3 flex flex-col justify-between">
                  <span className="text-[11px] text-[#858585] font-medium">
                    Dribbles
                  </span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-black text-[#7C3AED]">
                      {activeVideo.metrics.dribbles || 28}
                    </span>
                    <span className="text-[10px] text-[#7C3AED]">68% succ</span>
                  </div>
                </div>

                {/* Sprints */}
                <div className="col-span-2 bg-[#FAF8F4] border border-[#E8E3D8] rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-[#858585] font-medium block">
                      High-Velocity Sprints (&gt;25 km/h)
                    </span>
                    <span className="text-xs text-[#858585]">
                      Top: Marcus Silva #7 (33.2 km/h)
                    </span>
                  </div>
                  <div className="text-2xl font-black text-[#2563EB]">
                    {activeVideo.metrics.sprints || 64}
                  </div>
                </div>
              </div>

              {/* Quick AI Insight Box */}
              <div className="mt-4 p-3 rounded-xl bg-[#FAF8F4] border border-[#7C3AED]/25 flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-[#7C3AED] shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="font-bold text-[#242424]">AI Coach Insight: </span>
                  <span className="text-[#404040]">
                    Ahmed Khan completed 52 passes and unlocked 2 key chances. Overloading the left flank created 72% of offensive threat.
                  </span>
                </div>
              </div>
            </div>

            {/* Match Metadata Pill */}
            <div className="bg-[#FBFAF7] border border-[#E8E3D8] rounded-xl p-3 flex items-center justify-between text-xs text-[#858585]">
              <div>
                <span className="text-[#242424] font-semibold block">{activeVideo.matchName}</span>
                <span className="text-[11px] text-[#858585]">{activeVideo.date} • {activeVideo.duration} • {activeVideo.size}</span>
              </div>
              <button
                onClick={() => setActivePage('analysis')}
                className="px-2.5 py-1 rounded-lg bg-[#EEEBE3] hover:bg-[#E8E3D8] text-[#242424] border border-[#D9D3C5] font-medium transition-colors"
              >
                Inspect
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 3. QUICK ACTIONS ROW */}
      <section className="space-y-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#858585]">
          Quick Actions
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          {/* Card 1: Upload Video */}
          <div
            onClick={() => setActivePage('upload')}
            className="group cursor-pointer bg-[#FAF8F4] hover:bg-[#FBFAF7] border border-[#E8E3D8] hover:border-[#D9D3C5] rounded-2xl p-5 transition-all duration-200 shadow-2xs flex flex-col justify-between"
          >
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#EFEBE1] border border-[#E8E3D8] text-[#242424] flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                <UploadCloud className="w-5 h-5 text-[#555555]" />
              </div>
              <h4 className="text-base font-bold text-[#242424] group-hover:text-[#171717] transition-colors">
                Upload Video
              </h4>
              <p className="text-xs text-[#858585] mt-1">
                Analyse your next session
              </p>
            </div>
            <div className="mt-5 pt-3 border-t border-[#E8E3D8] flex items-center justify-between text-xs font-semibold text-[#262626]">
              <span>Drop match or training file</span>
              <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </div>
          </div>

          {/* Card 2: View Training Plans */}
          <div
            onClick={() => setActivePage('training')}
            className="group cursor-pointer bg-[#FAF8F4] hover:bg-[#FBFAF7] border border-[#E8E3D8] hover:border-[#D9D3C5] rounded-2xl p-5 transition-all duration-200 shadow-2xs flex flex-col justify-between"
          >
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#EFEBE1] border border-[#E8E3D8] text-[#242424] flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                <Dumbbell className="w-5 h-5 text-[#555555]" />
              </div>
              <h4 className="text-base font-bold text-[#242424] group-hover:text-[#171717] transition-colors">
                View Training Plans
              </h4>
              <p className="text-xs text-[#858585] mt-1">
                Get personalised drills
              </p>
            </div>
            <div className="mt-5 pt-3 border-t border-[#E8E3D8] flex items-center justify-between text-xs font-semibold text-[#262626]">
              <span>6 tailored drills ready</span>
              <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </div>
          </div>

          {/* Card 3: Player Analytics */}
          <div
            onClick={() => setActivePage('players')}
            className="group cursor-pointer bg-[#FAF8F4] hover:bg-[#FBFAF7] border border-[#E8E3D8] hover:border-[#D9D3C5] rounded-2xl p-5 transition-all duration-200 shadow-2xs flex flex-col justify-between"
          >
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#EFEBE1] border border-[#E8E3D8] text-[#242424] flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                <Users className="w-5 h-5 text-[#555555]" />
              </div>
              <h4 className="text-base font-bold text-[#242424] group-hover:text-[#171717] transition-colors">
                Player Analytics
              </h4>
              <p className="text-xs text-[#858585] mt-1">
                Track player performance
              </p>
            </div>
            <div className="mt-5 pt-3 border-t border-[#E8E3D8] flex items-center justify-between text-xs font-semibold text-[#262626]">
              <span>Inspect Ahmed Khan #10</span>
              <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
