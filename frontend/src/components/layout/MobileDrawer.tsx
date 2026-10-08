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
  X,
  Sparkles,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { PageId } from '@/types/football';

export const MobileDrawer: React.FC = () => {
  const {
    activePage,
    setActivePage,
    mobileMenuOpen,
    setMobileMenuOpen,
  } = useFootball();

  if (!mobileMenuOpen) return null;

  const navItems: Array<{ id: PageId; label: string; icon: React.ElementType; badge?: string }> = [
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

  const handleNav = (id: PageId) => {
    setActivePage(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 lg:hidden flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={() => setMobileMenuOpen(false)}
      />

      {/* Drawer */}
      <div className="relative w-72 max-w-[80vw] bg-[#09162A] border-r border-[#1B3554] h-full flex flex-col justify-between p-4 z-10 animate-in slide-in-from-left duration-200">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-[#1B3554]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#0B5CFF] flex items-center justify-center text-white font-bold text-xs">
                FC
              </div>
              <div>
                <span className="text-sm font-bold text-white block">
                  FootballCoach
                </span>
                <span className="text-[10px] text-[#94A3B8]">
                  Train Smarter. Play Better.
                </span>
              </div>
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-1 rounded-lg text-[#94A3B8] hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="mt-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNav(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-[#0B5CFF] text-white shadow-lg shadow-blue-500/30'
                      : 'text-[#94A3B8] hover:bg-[#0D203B] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/20 text-white">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom AI Box */}
        <div
          onClick={() => handleNav('training')}
          className="bg-gradient-to-r from-[#0D1D35] to-[#152239] border border-[#1B3554] rounded-xl p-3 cursor-pointer"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-white mb-1">
            <Sparkles className="w-3.5 h-3.5 text-[#8B5CF6]" />
            <span>AI Coach Assistant</span>
          </div>
          <p className="text-[10px] text-[#94A3B8]">
            Get personalised drills and tactical advice.
          </p>
        </div>
      </div>
    </div>
  );
};
