'use client';

import React, { createContext, useContext, useState } from 'react';
import {
  PageId,
  MatchVideo,
  PlayerStats,
  MatchEvent,
  TeamStats,
  TrainingDrill,
  ReportItem,
  TeamProfileSettings,
} from '@/types/football';
import {
  INITIAL_VIDEOS,
  PLAYERS_DATA,
  MATCH_EVENTS,
  TEAM_ANALYTICS,
  TRAINING_DRILLS,
  REPORTS_DATA,
  DEFAULT_SETTINGS,
} from '@/lib/mockData';

interface AIChatMessage {
  id: string;
  sender: 'user' | 'coach';
  text: string;
  time: string;
  suggestions?: string[];
}

interface FootballContextType {
  activePage: PageId;
  setActivePage: (page: PageId) => void;
  videos: MatchVideo[];
  activeVideo: MatchVideo;
  setActiveVideo: (video: MatchVideo) => void;
  simulateUpload: (fileName: string, fileSize: string) => void;
  players: PlayerStats[];
  selectedPlayer: PlayerStats;
  setSelectedPlayer: (player: PlayerStats) => void;
  events: MatchEvent[];
  selectedEvent: MatchEvent | null;
  setSelectedEvent: (event: MatchEvent | null) => void;
  teamStats: TeamStats;
  trainingDrills: TrainingDrill[];
  reports: ReportItem[];
  generateReport: (title: string, match: string, type: 'Match Report' | 'Player Report' | 'Team Performance') => void;
  settings: TeamProfileSettings;
  updateSettings: (newSettings: Partial<TeamProfileSettings>) => void;
  aiChatMessages: AIChatMessage[];
  sendAIChat: (message: string) => void;
  confidenceThreshold: number;
  setConfidenceThreshold: (val: number) => void;
  activeVideoTab: 'overview' | 'tracking' | 'heatmap' | 'pass_network' | 'events' | 'raw';
  setActiveVideoTab: (tab: 'overview' | 'tracking' | 'heatmap' | 'pass_network' | 'events' | 'raw') => void;
  toastMessage: string | null;
  showToast: (msg: string) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
}

const FootballContext = createContext<FootballContextType | undefined>(undefined);

export const FootballProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [videos, setVideos] = useState<MatchVideo[]>(INITIAL_VIDEOS);
  const [activeVideo, setActiveVideo] = useState<MatchVideo>(INITIAL_VIDEOS[0]);
  const [players] = useState<PlayerStats[]>(PLAYERS_DATA);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerStats>(PLAYERS_DATA[0]);
  const [events] = useState<MatchEvent[]>(MATCH_EVENTS);
  const [selectedEvent, setSelectedEvent] = useState<MatchEvent | null>(null);
  const [teamStats] = useState<TeamStats>(TEAM_ANALYTICS);
  const [trainingDrills] = useState<TrainingDrill[]>(TRAINING_DRILLS);
  const [reports, setReports] = useState<ReportItem[]>(REPORTS_DATA);
  const [settings, setSettings] = useState<TeamProfileSettings>(DEFAULT_SETTINGS);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.25);
  const [activeVideoTab, setActiveVideoTab] = useState<'overview' | 'tracking' | 'heatmap' | 'pass_network' | 'events' | 'raw'>('overview');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const [aiChatMessages, setAiChatMessages] = useState<AIChatMessage[]>([
    {
      id: 'msg-1',
      sender: 'coach',
      text: 'Good evening Coach Alex. I analysed your latest fixture against Rapid Stars. We achieved 58% possession, but detected a 22% passing completion drop in the final 15 minutes. How can I assist you?',
      time: '18:40',
      suggestions: [
        'Recommend passing drills for Ahmed Khan',
        'Analyze right-wing underload',
        'Show high-pressing stamina dropoff',
      ],
    },
  ]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 3500);
  };

  const simulateUpload = (fileName: string, fileSize: string) => {
    const newId = `vid-${Date.now()}`;
    const newVideo: MatchVideo = {
      id: newId,
      filename: fileName,
      matchName: fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' '),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      duration: '45:00',
      size: fileSize,
      status: 'Uploading',
      progress: 15,
      thumbnail: '/match_tactical_frame.jpg',
      detections: { players: 0, ball: 0, goals: 0, referee: 0 },
      modelConfidence: 0,
      metrics: { passes: 0, shots: 0, dribbles: 0, sprints: 0 },
    };

    setVideos((prev) => [newVideo, ...prev]);
    showToast(`Video "${fileName}" uploaded! Running YOLO detection pipeline...`);

    // Simulate pipeline progression
    setTimeout(() => {
      setVideos((prev) =>
        prev.map((v) =>
          v.id === newId ? { ...v, status: 'Processing', progress: 48 } : v
        )
      );
    }, 2000);

    setTimeout(() => {
      setVideos((prev) =>
        prev.map((v) =>
          v.id === newId ? { ...v, status: 'Analysing', progress: 82 } : v
        )
      );
    }, 4500);

    setTimeout(() => {
      setVideos((prev) =>
        prev.map((v) =>
          v.id === newId
            ? {
                ...v,
                status: 'Completed',
                progress: 100,
                detections: { players: 22, ball: 1, goals: 2, referee: 1 },
                modelConfidence: 94.6,
                metrics: { passes: 312, shots: 16, dribbles: 24, sprints: 58 },
              }
            : v
        )
      );
      showToast(`Analysis completed for "${fileName}"! Results ready to inspect.`);
    }, 7000);
  };

  const generateReport = (title: string, match: string, type: 'Match Report' | 'Player Report' | 'Team Performance') => {
    const newReport: ReportItem = {
      id: `rep-${Date.now()}`,
      title,
      match,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      type,
      status: 'Ready',
      fileSize: '3.6 MB PDF',
      summary: `Automated analytical report compiled from computer vision detections, team tactical positioning, and event telemetry.`,
      keyMetrics: [
        { label: 'Overall Efficiency', value: '88%' },
        { label: 'Key Events Logged', value: '142' },
        { label: 'YOLO Confidence', value: '94.2%' },
        { label: 'Export Format', value: 'Standard PDF / CSV' },
      ],
    };
    setReports((prev) => [newReport, ...prev]);
    showToast(`Generated "${title}" successfully!`);
  };

  const updateSettings = (newSettings: Partial<TeamProfileSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
    showToast('Settings saved successfully.');
  };

  const sendAIChat = (text: string) => {
    const userMsg: AIChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setAiChatMessages((prev) => [...prev, userMsg]);

    setTimeout(() => {
      let botResponse = `I've analyzed the telemetry for that query. Based on our 342 passes and player positioning heatmap, the team maintains strong central control but needs quicker lateral switches.`;
      const lower = text.toLowerCase();
      if (lower.includes('ahmed') || lower.includes('passing')) {
        botResponse = `Ahmed Khan completed 52/60 passes (86% accuracy) with 8.4 km covered. In the final third, his success rate dipped to 64%. I recommend the "Passing & Combination Play" drill (45 min) focusing on rapid one-touch wall passes.`;
      } else if (lower.includes('finish') || lower.includes('shot')) {
        botResponse = `Your squad recorded 14 shots with 7 on target (xG 2.14). Gabriel Ramos took 5 shots (4 on target) scoring 1 goal. To elevate finishing conversion, drill cutbacks from the left wing into the penalty arc.`;
      } else if (lower.includes('defen') || lower.includes('press')) {
        botResponse = `The high-press defensive structure yielded 42% pressing efficiency. Center-back Tariq Aziz recorded 14 clearances with 91% pass accuracy. Implementing the "5-second counter-press rule" will stop opposition counterattacks earlier.`;
      } else if (lower.includes('stamina') || lower.includes('fitness') || lower.includes('speed')) {
        botResponse = `Top sprint recorded was 33.2 km/h by Marcus Silva. However, sprint count dropped by 35% after the 75th minute. Adding the "Explosive Sprint & Stamina Endurance" routine will sustain late-match intensity.`;
      }

      const botMsg: AIChatMessage = {
        id: `msg-${Date.now() + 1}`,
        sender: 'coach',
        text: botResponse,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestions: ['Add drill to training plan', 'View player heatmap', 'Export tactical summary'],
      };
      setAiChatMessages((prev) => [...prev, botMsg]);
    }, 700);
  };

  return (
    <FootballContext.Provider
      value={{
        activePage,
        setActivePage,
        videos,
        activeVideo,
        setActiveVideo,
        simulateUpload,
        players,
        selectedPlayer,
        setSelectedPlayer,
        events,
        selectedEvent,
        setSelectedEvent,
        teamStats,
        trainingDrills,
        reports,
        generateReport,
        settings,
        updateSettings,
        aiChatMessages,
        sendAIChat,
        confidenceThreshold,
        setConfidenceThreshold,
        activeVideoTab,
        setActiveVideoTab,
        toastMessage,
        showToast,
        mobileMenuOpen,
        setMobileMenuOpen,
      }}
    >
      {children}
    </FootballContext.Provider>
  );
};

export const useFootball = () => {
  const context = useContext(FootballContext);
  if (!context) {
    throw new Error('useFootball must be used within a FootballProvider');
  }
  return context;
};
