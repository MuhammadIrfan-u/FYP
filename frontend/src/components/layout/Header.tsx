'use client';

import React, { useState } from 'react';
import {
  Bell,
  Search,
  Menu,
  X,
  Sparkles,
  ChevronDown,
  CheckCircle2,
  Clock,
  Shield,
  Activity,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';

export const Header: React.FC = () => {
  const {
    activePage,
    setActivePage,
    mobileMenuOpen,
    setMobileMenuOpen,
    settings,
  } = useFootball();

  const [notificationsOpen, setNotificationsOpen] = useState<boolean>(false);

  // Dynamic header titles based on page
  const getPageInfo = () => {
    switch (activePage) {
      case 'dashboard':
        return {
          title: 'Good evening, Coach!',
          subtitle: "Here's your team's performance overview.",
        };
      case 'upload':
        return {
          title: 'Upload Video',
          subtitle: 'Upload a match or training session to get AI-powered analysis.',
        };
      case 'analysis':
        return {
          title: 'Analysis Results',
          subtitle: 'YOLO Computer Vision detection breakdown & tactical intelligence.',
        };
      case 'players':
        return {
          title: 'Player Analytics',
          subtitle: 'Track individual performance, heatmaps, and movement paths.',
        };
      case 'events':
        return {
          title: 'Match Events',
          subtitle: 'Chronological timeline of detected passes, shots, dribbles, and sprints.',
        };
      case 'team':
        return {
          title: 'Team Analytics',
          subtitle: 'Collective metrics, tactical formations, passing networks, and territorial zones.',
        };
      case 'training':
        return {
          title: 'Training Plans',
          subtitle: 'Personalised drills based on your team\'s analytics and AI coaching advice.',
        };
      case 'reports':
        return {
          title: 'Reports',
          subtitle: 'Comprehensive match dossiers and exported analytical summaries.',
        };
      case 'settings':
        return {
          title: 'Settings',
          subtitle: 'Team profile, computer vision thresholds, and coaching preferences.',
        };
      default:
        return {
          title: 'Good evening, Coach!',
          subtitle: "Here's your team's performance overview.",
        };
    }
  };

  const { title, subtitle } = getPageInfo();

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
    <header className="sticky top-0 z-30 bg-[#061122]/90 backdrop-blur-xl border-b border-[#1B3554] px-4 lg:px-8 py-3.5 flex items-center justify-between transition-all">
      {/* Left: Mobile hamburger & Dynamic Page Heading */}
      <div className="flex items-center gap-3">
        {/* Mobile menu trigger */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="lg:hidden p-2 rounded-xl bg-[#0D1D35] border border-[#1B3554] text-[#CBD5E1] hover:text-white"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-[#F8FAFC] tracking-tight">
            {title}
          </h2>
          <p className="text-xs text-[#94A3B8] font-medium hidden sm:block">
            {subtitle}
          </p>
        </div>
      </div>

      {/* Right Side: Search, Notification icon, Coach Profile */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Quick Search Jump */}
        <div className="hidden md:flex items-center bg-[#0D1D35] border border-[#1B3554] rounded-xl px-3 py-1.5 text-xs text-[#94A3B8] focus-within:border-[#0B5CFF] transition-colors w-48 lg:w-56">
          <Search className="w-3.5 h-3.5 mr-2 text-[#64748B]" />
          <input
            type="text"
            placeholder="Search players, matches..."
            className="bg-transparent border-none outline-none text-[#F8FAFC] placeholder-[#64748B] w-full text-xs"
          />
        </div>

        {/* Notifications Popover */}
        <div className="relative">
          <button
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            className="relative p-2.5 rounded-xl bg-[#0D1D35] hover:bg-[#0D203B] border border-[#1B3554] text-[#CBD5E1] hover:text-white transition-all shadow-sm"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#0B5CFF] ring-2 ring-[#0D1D35] animate-pulse" />
          </button>

          {/* Notifications Dropdown */}
          {notificationsOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-[#09162A] border border-[#1B3554] rounded-2xl shadow-2xl shadow-black/60 p-3 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="flex items-center justify-between pb-2 border-b border-[#1B3554]/70 px-2">
                <span className="text-xs font-bold text-[#F8FAFC] uppercase tracking-wider">
                  Tactical Notifications
                </span>
                <span className="text-[10px] text-[#0B5CFF] font-semibold cursor-pointer hover:underline">
                  Mark all as read
                </span>
              </div>
              <div className="divide-y divide-[#1B3554]/40 mt-1 max-h-72 overflow-y-auto">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="p-2.5 hover:bg-[#0D203B] rounded-xl transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#F8FAFC] flex items-center gap-1.5">
                        {n.unread && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#0B5CFF]" />
                        )}
                        {n.title}
                      </span>
                      <span className="text-[10px] text-[#64748B] font-mono">
                        {n.time}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#94A3B8] mt-1 leading-relaxed">
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
          className="flex items-center gap-3 pl-2 sm:pl-3 border-l border-[#1B3554]/70 cursor-pointer group"
        >
          {/* Coach Avatar */}
          <div className="relative">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-[#0B5CFF] to-[#22C55E] flex items-center justify-center text-white font-bold text-sm shadow-md border border-white/20 group-hover:scale-105 transition-transform">
              AV
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#22C55E] border-2 border-[#061122]" />
          </div>

          <div className="text-left hidden sm:block">
            <div className="text-xs font-bold text-[#F8FAFC] group-hover:text-[#3B82F6] transition-colors flex items-center gap-1">
              {settings.coachName}
              <ChevronDown className="w-3 h-3 text-[#64748B]" />
            </div>
            <div className="text-[10px] text-[#94A3B8] font-medium flex items-center gap-1">
              <span className="px-1 py-0.2 rounded bg-[#0D203B] border border-[#1B3554] text-[#3B82F6] text-[9px] font-bold">
                PRO
              </span>
              <span>{settings.coachLicense.split('/')[0].trim()}</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
