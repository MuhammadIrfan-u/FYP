'use client';

import React from 'react';
import { FootballProvider } from '@/context/FootballContext';
import { DashboardShell } from '@/components/layout/DashboardShell';

export default function Home() {
  return (
    <FootballProvider>
      <DashboardShell />
    </FootballProvider>
  );
}
