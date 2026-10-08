'use client';

import React, { useState } from 'react';
import {
  Dumbbell,
  Sparkles,
  Send,
  Clock,
  Award,
  ArrowRight,
  CheckCircle2,
  Zap,
  Play,
  RotateCcw,
  MessageSquare,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { TrainingDrill } from '@/types/football';

export const TrainingPlansView: React.FC = () => {
  const {
    trainingDrills,
    aiChatMessages,
    sendAIChat,
    showToast,
  } = useFootball();

  const [activeCategory, setActiveCategory] = useState<string>('Recommended');
  const [chatInput, setChatInput] = useState<string>('');
  const [activeDrillModal, setActiveDrillModal] = useState<TrainingDrill | null>(null);

  const categories = ['Recommended', 'Dribbling', 'Passing', 'Shooting', 'Defending', 'Fitness'];

  const filteredDrills = trainingDrills.filter((drill) => {
    if (activeCategory === 'Recommended') return true;
    return drill.category.toLowerCase() === activeCategory.toLowerCase();
  });

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendAIChat(chatInput.trim());
    setChatInput('');
  };

  const handleQuickPrompt = (prompt: string) => {
    sendAIChat(prompt);
  };

  const getDifficultyBadge = (difficulty: string) => {
    switch (difficulty) {
      case 'Beginner':
        return 'bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/20';
      case 'Intermediate':
        return 'bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20';
      case 'Advanced':
        return 'bg-[#DC2626]/10 text-[#DC2626] border-[#DC2626]/20';
      default:
        return 'bg-[#2563EB]/10 text-[#2563EB] border-[#2563EB]/20';
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* 1. TITLE & SUBTITLE */}
      <div>
        <h3 className="text-xl sm:text-2xl font-black text-[#242424] tracking-tight">
          Training Plans
        </h3>
        <p className="text-xs sm:text-sm text-[#858585] mt-1">
          Personalised drills based on your team&apos;s analytics.
        </p>
      </div>

      {/* 2. PROMINENT AI COACH SECTION */}
      <section className="bg-[#FAF8F4] border border-[#E8E3D8] hover:border-[#7C3AED]/40 rounded-3xl p-6 sm:p-8 shadow-sm relative overflow-hidden space-y-6">
        {/* Subtle decorative purple glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#7C3AED]/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3.5 rounded-2xl bg-[#7C3AED]/10 border border-[#7C3AED]/20 text-[#7C3AED] shadow-sm shrink-0">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#7C3AED]">
                  AI Coaching Intelligence
                </span>
                <span className="w-2 h-2 rounded-full bg-[#16A34A] animate-pulse" />
              </div>
              <h4 className="text-base sm:text-lg font-bold text-[#242424] mt-0.5">
                Based on your team&apos;s latest analysis, your passing accuracy can be improved.
              </h4>
              <p className="text-xs text-[#404040] mt-1 max-w-2xl leading-relaxed">
                YOLO telemetry detected a 22% final-third accuracy drop during minutes 60-75. We have scheduled 3 high-intensity combination drills to refine your midfield transitions.
              </p>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={() => handleQuickPrompt('Generate a comprehensive 5-day training plan for the squad')}
              className="px-3.5 py-2 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-bold shadow-sm transition-all flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generate Training Plan</span>
            </button>
            <button
              onClick={() => handleQuickPrompt('How can we improve passing accuracy in the final third?')}
              className="px-3.5 py-2 rounded-xl bg-[#FBFAF7] hover:bg-[#EEEBE3] border border-[#E8E3D8] text-[#404040] hover:text-[#242424] text-xs font-semibold transition-all"
            >
              Improve Passing
            </button>
            <button
              onClick={() => handleQuickPrompt('Give me drills to improve shot finishing and conversion')}
              className="px-3.5 py-2 rounded-xl bg-[#FBFAF7] hover:bg-[#EEEBE3] border border-[#E8E3D8] text-[#404040] hover:text-[#242424] text-xs font-semibold transition-all"
            >
              Improve Finishing
            </button>
            <button
              onClick={() => handleQuickPrompt('How can we optimize our counter-pressing defensive transition?')}
              className="px-3.5 py-2 rounded-xl bg-[#FBFAF7] hover:bg-[#EEEBE3] border border-[#E8E3D8] text-[#404040] hover:text-[#242424] text-xs font-semibold transition-all"
            >
              Improve Defence
            </button>
          </div>
        </div>

        {/* AI Chat Dialogue Stream */}
        <div className="bg-[#FBFAF7] border border-[#E8E3D8] rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8] text-xs">
            <span className="font-bold text-[#242424] flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#7C3AED]" />
              <span>Interactive Tactical Assistant</span>
            </span>
            <span className="text-[11px] text-[#858585] font-mono">
              Live Model Synced with Video Telemetry
            </span>
          </div>

          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {aiChatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.sender === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-xl p-3.5 rounded-2xl text-xs leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-[#262626] text-white rounded-tr-none'
                      : 'bg-[#EEEBE3] text-[#242424] border border-[#E8E3D8] rounded-tl-none'
                  }`}
                >
                  <p>{msg.text}</p>
                  <span className="text-[10px] opacity-70 block text-right mt-1 font-mono">
                    {msg.time}
                  </span>
                </div>

                {/* Suggestions / Quick chips */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {msg.suggestions.map((s, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleQuickPrompt(s)}
                        className="text-[10px] px-2.5 py-1 rounded-full bg-[#FBFAF7] hover:bg-[#EEEBE3] text-[#7C3AED] border border-[#7C3AED]/30 transition-all font-medium"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Chat Input Bar */}
          <form onSubmit={handleSendMessage} className="flex items-center gap-2 pt-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask AI Coach about your team, players, or drills..."
              className="flex-1 bg-[#FAF8F4] border border-[#E8E3D8] rounded-xl px-4 py-2.5 text-xs text-[#242424] placeholder-[#858585] focus:outline-none focus:border-[#7C3AED] transition-colors"
            />
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ask Coach</span>
            </button>
          </form>
        </div>
      </section>

      {/* 3. CATEGORY PILLS */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeCategory === cat
                ? 'bg-[#262626] text-white shadow-sm'
                : 'bg-[#FBFAF7] hover:bg-[#EEEBE3] text-[#404040] border border-[#E8E3D8]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* 4. DRILL CARDS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredDrills.map((drill) => {
          const badgeStyle = getDifficultyBadge(drill.difficulty);
          return (
            <div
              key={drill.id}
              className="group bg-[#FAF8F4] hover:bg-[#FBFAF7] border border-[#E8E3D8] hover:border-[#262626] rounded-2xl overflow-hidden shadow-sm transition-all duration-200 flex flex-col justify-between"
            >
              <div>
                {/* Training Image Header */}
                <div className="relative aspect-video w-full bg-[#EEEBE3] overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={drill.image || '/training_drill_session.jpg'}
                    alt={drill.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute top-3 left-3 flex items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-sm ${badgeStyle}`}
                    >
                      {drill.difficulty}
                    </span>
                  </div>
                  <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-black/75 text-white font-mono text-[11px] font-semibold flex items-center gap-1">
                    <Clock className="w-3 h-3 text-[#E8E3D8]" />
                    <span>{drill.duration}</span>
                  </div>
                </div>

                {/* Content */}
                <div className="p-5 space-y-3">
                  <h4 className="text-base font-bold text-[#242424] group-hover:text-[#171717] transition-colors">
                    {drill.name}
                  </h4>
                  <p className="text-xs text-[#858585] leading-relaxed">
                    {drill.description}
                  </p>

                  {/* AI Reason callout if available */}
                  {drill.aiRecommendedReason && (
                    <div className="p-2.5 rounded-xl bg-[#7C3AED]/10 border border-[#7C3AED]/20 text-[11px] text-[#7C3AED] flex items-start gap-2">
                      <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#7C3AED]" />
                      <span>{drill.aiRecommendedReason}</span>
                    </div>
                  )}

                  {/* Focus Tags */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {drill.focusAreas.map((tag, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-[#EEEBE3] text-[#404040] border border-[#E8E3D8]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Start Training Button Footer */}
              <div className="p-5 pt-0">
                <button
                  onClick={() => showToast(`Drill "${drill.name}" added to today's squad training schedule!`)}
                  className="w-full py-2.5 rounded-xl bg-[#262626] hover:bg-[#171717] text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Start Training</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
