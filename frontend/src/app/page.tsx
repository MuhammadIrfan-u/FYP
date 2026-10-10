'use client';

import React from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { FootballProvider } from '@/context/FootballContext';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { AuthView } from '@/components/auth/AuthView';

function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7F4EE] flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-2xl bg-[#262626] flex items-center justify-center text-white mb-4 animate-pulse shadow-sm">
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
        <p className="text-xs font-bold uppercase tracking-wider text-[#555555]">
          Initializing FootballCoach PRO...
        </p>
      </div>
    );
  }

  if (!user) {
    return <AuthView />;
  }

  return (
    <FootballProvider>
      <DashboardShell />
    </FootballProvider>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
