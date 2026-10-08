'use client';

import React from 'react';
import { useFootball } from '@/context/FootballContext';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { DashboardView } from '@/components/pages/DashboardView';
import { UploadView } from '@/components/pages/UploadView';
import { AnalysisView } from '@/components/pages/AnalysisView';
import { MatchEventsView } from '@/components/pages/MatchEventsView';
import { ReportsView } from '@/components/pages/ReportsView';
import { SettingsView } from '@/components/pages/SettingsView';
import { CheckCircle2 } from 'lucide-react';

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
      case 'events':
        return <MatchEventsView />;
      case 'reports':
        return <ReportsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F4EE] text-[#404040] flex flex-col lg:flex-row antialiased">
      {/* Desktop Fixed Sidebar */}
      <div className="hidden lg:block w-64 shrink-0">
        <Sidebar />
      </div>

      {/* Mobile Drawer */}
      <MobileDrawer />

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#F7F4EE] overflow-x-hidden">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto pb-16">
          {renderActivePage()}
        </main>
      </div>

      {/* Global Interactive Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#FAF8F4] border border-[#262626] text-[#242424] shadow-xl animate-in slide-in-from-bottom-4 duration-200">
          <div className="p-1 rounded-lg bg-[#262626] text-white">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
