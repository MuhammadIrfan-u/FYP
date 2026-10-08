'use client';

import React from 'react';
import {
  LayoutDashboard,
  UploadCloud,
  Cpu,
  Users,
  Activity,
  Layers,
  Dumbbell,
  FileText,
  Settings,
  Sparkles,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { PageId } from '@/types/football';

interface NavItem {
  id: PageId;
  label: string;
  icon: React.ElementType;
  badge?: string;
}

export const Sidebar: React.FC = () => {
  const { activePage, setActivePage, setMobileMenuOpen } = useFootball();

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'upload', label: 'Upload Video', icon: UploadCloud },
    { id: 'analysis', label: 'Video Analysis', icon: Cpu, badge: 'YOLO' },
    { id: 'players', label: 'Player Analytics', icon: Users },
    { id: 'events', label: 'Match Events', icon: Activity },
    { id: 'team', label: 'Team Analytics', icon: Layers },
    { id: 'training', label: 'Training Plans', icon: Dumbbell, badge: 'AI' },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleNavClick = (pageId: PageId) => {
    setActivePage(pageId);
    setMobileMenuOpen(false);
  };

  return (
    <aside className="w-64 bg-[#09162A] border-r border-[#1B3554] flex flex-col justify-between h-screen fixed left-0 top-0 z-40 select-none">
      {/* Brand Header */}
      <div>
        <div className="p-5 border-b border-[#1B3554]/70 flex items-center gap-3">
          {/* Logo Icon */}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0B5CFF] to-[#3B82F6] flex items-center justify-center shadow-lg shadow-blue-500/25 border border-white/20">
            <svg
              className="w-6 h-6 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m4.93 4.93 4.24 4.24" />
              <path d="m14.83 9.17 4.24-4.24" />
              <path d="m14.83 14.83 4.24 4.24" />
              <path d="m9.17 14.83-4.24 4.24" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight text-[#F8FAFC] flex items-center gap-1.5">
              FootballCoach
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#0B5CFF]/20 text-[#3B82F6] border border-[#0B5CFF]/30">
                PRO
              </span>
            </h1>
            <p className="text-[11px] font-medium text-[#94A3B8]">
              Train Smarter. Play Better.
            </p>
          </div>
        </div>

        {/* Navigation List */}
        <nav className="p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-250px)]">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
            Main Navigation
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-medium text-xs transition-all duration-150 group ${
                  isActive
                    ? 'bg-[#0B5CFF] text-[#FFFFFF] shadow-[0_0_18px_rgba(11,92,255,0.4)] font-semibold'
                    : 'text-[#94A3B8] hover:bg-[#0D203B] hover:text-[#F8FAFC]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      isActive
                        ? 'text-white'
                        : 'text-[#64748B] group-hover:text-[#3B82F6]'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>

                {item.badge && (
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : item.badge === 'AI'
                        ? 'bg-[#8B5CF6]/20 text-[#8B5CF6] border border-[#8B5CF6]/30'
                        : 'bg-[#0B5CFF]/20 text-[#3B82F6] border border-[#0B5CFF]/30'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* AI Coach Card at Sidebar Bottom */}
      <div className="p-3 border-t border-[#1B3554]/60">
        <div
          onClick={() => handleNavClick('training')}
          className="relative group cursor-pointer bg-gradient-to-br from-[#0D1D35] to-[#152239] hover:to-[#0D203B] border border-[#1B3554] hover:border-[#8B5CF6]/50 rounded-2xl p-3.5 transition-all duration-200 shadow-lg shadow-black/30 overflow-hidden"
        >
          {/* Subtle purple/blue AI accent lighting */}
          <div className="absolute -right-6 -bottom-6 w-20 h-20 bg-[#8B5CF6]/15 rounded-full blur-xl pointer-events-none group-hover:bg-[#8B5CF6]/25 transition-all" />

          <div className="flex items-center gap-2 mb-1.5">
            <div className="p-1.5 rounded-lg bg-[#8B5CF6]/20 text-[#8B5CF6] border border-[#8B5CF6]/30">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold text-[#F8FAFC] tracking-wide">
              AI Coach
            </span>
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse" />
          </div>

          <p className="text-[11px] text-[#94A3B8] leading-tight line-clamp-2">
            Get personalised training plans and feedback.
          </p>

          <div className="mt-2.5 pt-2 border-t border-[#1B3554]/60 flex items-center justify-between text-[11px] font-semibold text-[#8B5CF6] group-hover:text-[#A78BFA]">
            <span>Open Coach Studio</span>
            <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
          </div>
        </div>
      </div>
    </aside>
  );
};
