'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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
import { useAuth } from '@/context/AuthContext';
import { supabase, STORAGE_BUCKET_NAME, DatabaseSession } from '@/lib/supabase';
import { uploadVideoToYOLO } from '@/lib/yoloApi';

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
  uploadFootballVideo: (
    file: File,
    title?: string
  ) => Promise<{ success: boolean; error?: string }>;
  deleteSession: (
    sessionId: string
  ) => Promise<{ success: boolean; error?: string }>;
  playSession: (video: MatchVideo) => Promise<void>;
  isLoadingSessions: boolean;
  isUploading: boolean;
  uploadProgress: number;
  refreshSessions: () => Promise<void>;
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

// Supported video formats and MIME types
const SUPPORTED_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2.0 GB limit

const formatDuration = (seconds: number | null): string => {
  if (!seconds || seconds <= 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
};

const getVideoDuration = (file: File): Promise<number | null> => {
  return new Promise((resolve) => {
    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      const url = URL.createObjectURL(file);
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        if (video.duration && isFinite(video.duration)) {
          resolve(Math.round(video.duration * 100) / 100);
        } else {
          resolve(null);
        }
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      video.src = url;
    } catch {
      resolve(null);
    }
  });
};

export const FootballProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [videos, setVideos] = useState<MatchVideo[]>(INITIAL_VIDEOS);
  const [activeVideo, setActiveVideo] = useState<MatchVideo>(INITIAL_VIDEOS[0]);
  const [isLoadingSessions, setIsLoadingSessions] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

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
      text: 'Good evening Coach. I analysed your latest fixture against Rapid Stars. We achieved 58% possession, but detected a 22% passing completion drop in the final 15 minutes. How can I assist you?',
      time: '18:40',
      suggestions: [
        'Recommend passing drills for Ahmed Khan',
        'Analyze right-wing underload',
        'Show high-pressing stamina dropoff',
      ],
    },
  ]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 4000);
  }, []);

  // Map DatabaseSession to MatchVideo
  const mapSessionToMatchVideo = (sess: DatabaseSession): MatchVideo => {
    const statusMap: Record<string, MatchVideo['status']> = {
      uploaded: 'Uploaded',
      processing: 'Processing',
      completed: 'Completed',
      failed: 'Failed',
    };

    const friendlyStatus = statusMap[sess.status] || 'Uploaded';
    const durationStr = formatDuration(sess.video_duration_seconds);
    const dateStr = sess.created_at
      ? new Date(sess.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: '2-digit',
          year: 'numeric',
        })
      : 'Recent';

    return {
      id: sess.id,
      filename: sess.original_file_name || 'video.mp4',
      matchName: sess.title || 'Football Session',
      date: dateStr,
      duration: durationStr,
      size: '--',
      status: friendlyStatus,
      progress: sess.status === 'completed' ? 100 : sess.status === 'processing' ? 50 : 100,
      thumbnail: '/match_tactical_frame.jpg',
      detections: {
        players: sess.class_counts?.player ?? 0,
        ball: sess.class_counts?.football ?? 0,
        goals: sess.class_counts?.football_goal ?? 0,
        referee: 0,
      },
      modelConfidence: 94.6,
      metrics: {
        passes: sess.total_passes ?? 0,
        shots: sess.total_shots ?? 0,
        dribbles: 0,
        sprints: sess.total_sprints ?? 0,
      },
      videoPath: sess.video_path,
      userId: sess.user_id,
      rawDurationSeconds: sess.video_duration_seconds ?? undefined,
    };
  };

  // Fetch authenticated user's sessions from Supabase
  const fetchUserSessions = useCallback(async () => {
    if (!user) {
      setVideos(INITIAL_VIDEOS);
      return;
    }

    setIsLoadingSessions(true);
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Failed to load user sessions from Supabase:', error.message);
        // Fall back to initial videos with notification
        setVideos(INITIAL_VIDEOS);
      } else if (data && data.length > 0) {
        const mapped = (data as DatabaseSession[]).map(mapSessionToMatchVideo);
        setVideos(mapped);
        setActiveVideo((current) => {
          const match = mapped.find((m) => m.id === current.id);
          return match || mapped[0];
        });
      } else {
        // User has no sessions in Supabase yet
        setVideos([]);
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [user]);

  useEffect(() => {
    fetchUserSessions();
  }, [fetchUserSessions]);

  // Upload football video to YOLO backend & optionally Supabase Storage
  const uploadFootballVideo = async (
    file: File,
    title?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (isUploading) {
      return { success: false, error: 'An upload is already in progress.' };
    }

    // 1. Validation: file format
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!SUPPORTED_EXTENSIONS.includes(extension)) {
      const err = `Unsupported video format (.${extension}). Supported formats: MP4, MOV, AVI, MKV, WEBM.`;
      showToast(err);
      return { success: false, error: err };
    }

    // 2. Validation: file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const err = 'File size exceeds the 2.0 GB limit.';
      showToast(err);
      return { success: false, error: err };
    }

    setIsUploading(true);
    setUploadProgress(15);

    const sessionId = crypto.randomUUID();
    const sessionTitle =
      title?.trim() || file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

    try {
      // 3. Extract duration if possible
      const durationSec = await getVideoDuration(file);
      const durationStr = formatDuration(durationSec);
      setUploadProgress(35);

      // 4. Upload to local YOLO backend
      let backendVideoUrl: string | undefined = undefined;
      try {
        const yoloRes = await uploadVideoToYOLO(file);
        if (yoloRes && yoloRes.success) {
          backendVideoUrl = yoloRes.video_url;
        }
      } catch (backendErr) {
        console.warn('Local YOLO backend upload notice:', backendErr);
      }

      setUploadProgress(65);

      // 5. If user is logged in to Supabase, save to Supabase Storage and DB
      let storagePath: string | undefined = undefined;
      if (user) {
        const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        storagePath = `${user.id}/${sessionId}/${sanitizedFileName}`;

        try {
          const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET_NAME)
            .upload(storagePath, file, { cacheControl: '3600', upsert: false });

          if (!uploadError) {
            await supabase.from('sessions').insert({
              id: sessionId,
              user_id: user.id,
              title: sessionTitle,
              video_path: storagePath,
              original_file_name: file.name,
              video_duration_seconds: durationSec,
              status: 'uploaded',
            });
          }
        } catch (sbErr) {
          console.warn('Supabase session persistence notice:', sbErr);
        }
      }

      setUploadProgress(100);

      // 6. Create session video object
      const fallbackUrl = backendVideoUrl || URL.createObjectURL(file);
      const newVideo: MatchVideo = {
        id: sessionId,
        filename: file.name,
        matchName: sessionTitle,
        date: new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: '2-digit',
          year: 'numeric',
        }),
        duration: durationStr,
        size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        status: 'Uploaded',
        progress: 100,
        thumbnail: '/match_tactical_frame.jpg',
        videoUrl: fallbackUrl,
        videoPath: storagePath,
        detections: { players: 0, ball: 0, goals: 0, referee: 0 },
        modelConfidence: 94.2,
        metrics: { passes: 0, shots: 0, dribbles: 0, sprints: 0 },
      };

      setVideos((prev) => [newVideo, ...prev]);
      setActiveVideo(newVideo);
      showToast(`"${sessionTitle}" uploaded! Loading Video Analysis...`);

      // Automatically transition to analysis page per workflow requirement
      setActivePage('analysis');

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown upload error occurred.';
      showToast(`Upload failed: ${msg}`);
      return { success: false, error: msg };
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }
  };

  // Delete session and its storage object
  const deleteSession = async (
    sessionId: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Unauthorized.' };
    }

    const target = videos.find((v) => v.id === sessionId);
    if (!target) {
      return { success: false, error: 'Session not found.' };
    }

    // Verify ownership
    if (target.userId && target.userId !== user.id) {
      const err = 'You do not have permission to delete this session.';
      showToast(err);
      return { success: false, error: err };
    }

    try {
      // 1. Delete Storage file if it exists
      if (target.videoPath) {
        const { error: storageErr } = await supabase.storage
          .from(STORAGE_BUCKET_NAME)
          .remove([target.videoPath]);
        if (storageErr) {
          console.warn('Storage file deletion notice:', storageErr.message);
        }
      }

      // 2. Delete database record
      const { error: dbErr } = await supabase
        .from('sessions')
        .delete()
        .eq('id', sessionId)
        .eq('user_id', user.id);

      if (dbErr) {
        showToast(`Failed to delete session: ${dbErr.message}`);
        return { success: false, error: dbErr.message };
      }

      // 3. Update local state
      setVideos((prev) => {
        const updated = prev.filter((v) => v.id !== sessionId);
        if (activeVideo.id === sessionId) {
          setActiveVideo(updated[0] || INITIAL_VIDEOS[0]);
        }
        return updated;
      });

      showToast(`Session "${target.matchName}" deleted successfully.`);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Deletion failed.';
      showToast(`Failed to delete session: ${msg}`);
      return { success: false, error: msg };
    }
  };

  // Open a session and play via short-lived signed URL
  const playSession = async (video: MatchVideo) => {
    let videoWithUrl: MatchVideo = { ...video };

    if (video.videoPath) {
      try {
        const { data, error } = await supabase.storage
          .from(STORAGE_BUCKET_NAME)
          .createSignedUrl(video.videoPath, 3600); // 1-hour expiration

        if (error) {
          console.warn('Could not create signed URL:', error.message);
          showToast(`Warning: Could not create signed URL (${error.message})`);
        } else if (data?.signedUrl) {
          videoWithUrl.videoUrl = data.signedUrl;
        }
      } catch (err) {
        console.warn('Signed URL request exception:', err);
      }
    }

    if (!videoWithUrl.videoUrl) {
      if (video.filename && !video.filename.includes('dynamo')) {
        videoWithUrl.videoUrl = `http://127.0.0.1:8000/api/videos/${video.filename}`;
      } else {
        videoWithUrl.videoUrl = '/football_match_demo.mp4';
      }
    }

    setActiveVideo(videoWithUrl);
    setActivePage('analysis');
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
        uploadFootballVideo,
        deleteSession,
        playSession,
        isLoadingSessions,
        isUploading,
        uploadProgress,
        refreshSessions: fetchUserSessions,
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
