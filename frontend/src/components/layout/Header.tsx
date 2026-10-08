'use client';

import React, { useState } from 'react';
import {
  Bell,
  Search,
  Menu,
  X,
  ChevronDown,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';

export const Header: React.FC = () => {
  const {
    setActivePage,
    mobileMenuOpen,
    setMobileMenuOpen,
    settings,
  } = useFootball();

  const [notificationsOpen, setNotificationsOpen] = useState<boolean>(false);

  const notifications = [
    {
      id: 1,
      title: 'YOLO Analysis Finished',
      desc: 'FC Dynamo vs Rapid Stars - 1st Half detection completed (342 passes, 14 shots).',
      time: '12m ago',
      unread: true,
    },
    {
      id: 2,
      title: 'Tactical Alert: Right Flank Underload',
      desc: 'AI Coach noted right-wing touches at only 18% during the second 15m period.',
      time: '35m ago',
      unread: true,
    },
    {
      id: 3,
      title: 'Player Load Warning',
      desc: 'Marcus Silva sustained 32 sprints above 30 km/h. Monitor recovery.',
      time: '2h ago',
      unread: false,
    },
  ];

  return (
    <header className="sticky top-0 z-30 h-12 bg-[#F7F4EE]/85 backdrop-blur-md border-b border-[#E8E3D8] px-4 lg:px-8 flex items-center justify-between">
      {/* Left: Mobile hamburger menu trigger */}
      <div className="flex items-center gap-3">
        {/* Mobile menu trigger */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="lg:hidden p-1.5 rounded-lg bg-[#FAF8F4] border border-[#E8E3D8] text-[#555555] hover:text-[#242424]"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Right Side: Search, Notification icon, Coach Profile */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Quick Search Jump */}
        <div className="hidden md:flex items-center bg-[#FAF8F4] border border-[#E8E3D8] rounded-lg px-2.5 py-1 text-xs text-[#858585] focus-within:border-[#262626] transition-colors w-48 lg:w-64">
          <Search className="w-3.5 h-3.5 mr-2 text-[#858585]" />
          <input
            type="text"
            placeholder="Search players, matches..."
            className="bg-transparent border-none outline-none text-[#242424] placeholder-[#858585] w-full text-xs"
          />
        </div>

        {/* Notifications Popover */}
        <div className="relative">
          <button
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            className="relative p-1.5 rounded-lg hover:bg-[#EEEBE3] text-[#555555] hover:text-[#242424] transition-colors"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
          </button>

          {/* Notifications Dropdown */}
          {notificationsOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl shadow-xl p-3 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="flex items-center justify-between pb-2 border-b border-[#E8E3D8] px-2">
                <span className="text-xs font-bold text-[#242424] uppercase tracking-wider">
                  Tactical Notifications
                </span>
                <span className="text-[10px] text-[#262626] font-semibold cursor-pointer hover:underline">
                  Mark all as read
                </span>
              </div>
              <div className="divide-y divide-[#E8E3D8]/60 mt-1 max-h-72 overflow-y-auto">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="p-2.5 hover:bg-[#EEEBE3] rounded-xl transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#242424] flex items-center gap-1.5">
                        {n.unread && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
                        )}
                        {n.title}
                      </span>
                      <span className="text-[10px] text-[#858585] font-mono">
                        {n.time}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#404040] mt-1 leading-relaxed">
                      {n.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Coach Profile Card */}
        <div
          onClick={() => setActivePage('settings')}
          className="flex items-center gap-3 pl-2 sm:pl-3 border-l border-[#E8E3D8] cursor-pointer group"
        >
          {/* Coach Avatar */}
          <div className="relative">
            <div className="w-7 h-7 rounded-lg bg-[#262626] flex items-center justify-center text-white font-bold text-[11px] group-hover:scale-105 transition-transform">
              AV
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#16A34A] border-2 border-[#F7F4EE]" />
          </div>

          <div className="text-left hidden sm:flex items-center gap-1 text-xs font-semibold text-[#242424]">
            {settings.coachName}
            <ChevronDown className="w-3 h-3 text-[#858585]" />
          </div>
        </div>
      </div>
    </header>
  );
};
