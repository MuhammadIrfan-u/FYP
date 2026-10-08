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
    <aside className="w-64 bg-[#F9F7F2] border-r border-[#E8E3D8] flex flex-col justify-between h-screen fixed left-0 top-0 z-40 select-none">
      {/* Brand Header */}
      <div>
        <div className="p-5 border-b border-[#E8E3D8] flex items-center gap-3">
          {/* Logo Icon in charcoal */}
          <div className="w-10 h-10 rounded-xl bg-[#262626] flex items-center justify-center shadow-sm border border-[#D9D3C5]">
            <svg
              className="w-6 h-6 text-[#F9F7F2]"
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
            <h1 className="text-base font-extrabold tracking-tight text-[#242424] flex items-center gap-1.5">
              FootballCoach
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#EEEBE3] text-[#242424] border border-[#D9D3C5]">
                PRO
              </span>
            </h1>
            <p className="text-[11px] font-medium text-[#858585]">
              Train Smarter. Play Better.
            </p>
          </div>
        </div>

        {/* Navigation List */}
        <nav className="p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-250px)]">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#858585]">
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
                    ? 'bg-[#262626] text-[#FFFFFF] shadow-sm font-semibold'
                    : 'text-[#858585] hover:bg-[#EEEBE3] hover:text-[#242424]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      isActive
                        ? 'text-white'
                        : 'text-[#555555] group-hover:text-[#242424]'
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
                        ? 'bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20'
                        : 'bg-[#EEEBE3] text-[#404040] border border-[#D9D3C5]'
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
      <div className="p-3 border-t border-[#E8E3D8]">
        <div
          onClick={() => handleNavClick('training')}
          className="relative group cursor-pointer bg-[#FAF8F4] hover:bg-[#FBFAF7] border border-[#E8E3D8] hover:border-[#7C3AED]/40 rounded-2xl p-3.5 transition-all duration-200 shadow-sm overflow-hidden"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div className="p-1.5 rounded-lg bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold text-[#242424] tracking-wide">
              AI Coach
            </span>
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse" />
          </div>

          <p className="text-[11px] text-[#858585] leading-tight line-clamp-2">
            Get personalised training plans and feedback.
          </p>

          <div className="mt-2.5 pt-2 border-t border-[#E8E3D8] flex items-center justify-between text-[11px] font-semibold text-[#7C3AED] group-hover:text-[#6D28D9]">
            <span>Open Coach Studio</span>
            <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
          </div>
        </div>
      </div>
    </aside>
  );
};
