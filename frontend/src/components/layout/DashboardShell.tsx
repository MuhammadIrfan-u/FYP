'use client';

import React from 'react';
import { useFootball } from '@/context/FootballContext';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { DashboardView } from '@/components/pages/DashboardView';
import { UploadView } from '@/components/pages/UploadView';
import { AnalysisView } from '@/components/pages/AnalysisView';
import { PlayerAnalyticsView } from '@/components/pages/PlayerAnalyticsView';
import { MatchEventsView } from '@/components/pages/MatchEventsView';
import { TeamAnalyticsView } from '@/components/pages/TeamAnalyticsView';
import { TrainingPlansView } from '@/components/pages/TrainingPlansView';
import { ReportsView } from '@/components/pages/ReportsView';
import { SettingsView } from '@/components/pages/SettingsView';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

export const DashboardShell: React.FC = () => {
  const { activePage, toastMessage } = useFootball();

  const renderActivePage = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardView />;
      case 'upload':
        return <UploadView />;
      case 'analysis':
        return <AnalysisView />;
      case 'players':
        return <PlayerAnalyticsView />;
      case 'events':
        return <MatchEventsView />;
      case 'team':
        return <TeamAnalyticsView />;
      case 'training':
        return <TrainingPlansView />;
      case 'reports':
        return <ReportsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="min-h-screen bg-[#020E1D] text-[#F8FAFC] flex flex-col lg:flex-row antialiased">
      {/* Desktop Fixed Sidebar */}
      <div className="hidden lg:block w-64 shrink-0">
        <Sidebar />
      </div>

      {/* Mobile Drawer */}
      <MobileDrawer />

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#020E1D] overflow-x-hidden">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-16">
          {renderActivePage()}
        </main>
      </div>

      {/* Global Interactive Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#09162A]/95 backdrop-blur-xl border border-[#0B5CFF]/50 text-white shadow-2xl shadow-blue-500/30 animate-in slide-in-from-bottom-4 duration-200">
          <div className="p-1 rounded-lg bg-[#0B5CFF]/20 text-[#3B82F6]">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
