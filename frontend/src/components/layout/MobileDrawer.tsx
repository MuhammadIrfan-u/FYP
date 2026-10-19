'use client';

import React from 'react';
import {
  LayoutDashboard,
  UploadCloud,
  Cpu,
  Clapperboard,
  Activity,
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
    { id: 'sync_training', label: 'Sync Training Videos', icon: Clapperboard, badge: 'NEW' },
    { id: 'events', label: 'Match Events', icon: Activity },
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
        className="fixed inset-0 bg-[#262626]/40 backdrop-blur-xs transition-opacity"
        onClick={() => setMobileMenuOpen(false)}
      />

      {/* Drawer */}
      <div className="relative w-72 max-w-[80vw] bg-[#F9F7F2] border-r border-[#E8E3D8] h-full flex flex-col justify-between p-4 z-10 animate-in slide-in-from-left duration-200 shadow-xl">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-[#E8E3D8]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#262626] flex items-center justify-center text-white font-bold text-xs">
                FC
              </div>
              <div>
                <span className="text-sm font-bold text-[#242424] block">
                  FootballCoach
                </span>
                <span className="text-[10px] text-[#858585]">
                  Train Smarter. Play Better.
                </span>
              </div>
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-1 rounded-lg text-[#858585] hover:text-[#242424]"
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
                      ? 'bg-[#262626] text-white shadow-sm'
                      : 'text-[#858585] hover:bg-[#EEEBE3] hover:text-[#242424]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#EEEBE3] text-[#404040] border border-[#D9D3C5]">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom YOLO Box */}
        <div
          onClick={() => handleNav('analysis')}
          className="bg-[#FAF8F4] border border-[#E8E3D8] hover:border-[#D9D3C5] rounded-xl p-3 cursor-pointer shadow-2xs"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-[#242424] mb-1">
            <Cpu className="w-3.5 h-3.5 text-[#242424]" />
            <span>YOLO Analytics Engine</span>
          </div>
          <p className="text-[10px] text-[#858585]">
            Computer vision detection breakdown & tactical feed.
          </p>
        </div>
      </div>
    </div>
  );
};
