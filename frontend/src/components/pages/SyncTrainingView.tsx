'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Clapperboard,
  Upload,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Volume1,
  Sliders,
  Download,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Layers,
  ArrowRightLeft,
  ChevronRight,
  Maximize2,
  Film,
  Activity,
  FileVideo,
  Clock,
  Zap,
  GripVertical,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { SyncTrainingResult } from '@/types/football';
import { syncTrainingVideos, renderSyncedVideo, YOLO_API_BASE } from '@/lib/yoloApi';

export const SyncTrainingView: React.FC = () => {
  const { showToast } = useFootball();

  // Mode: 'original' (both start from 0:00 side-by-side) vs 'synced' (clap transient aligned)
  const [comparisonMode, setComparisonMode] = useState<'original' | 'synced'>('synced');

  // Selected files / sources
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [sampleFilenameA, setSampleFilenameA] = useState<string>('');
  const [sampleFilenameB, setSampleFilenameB] = useState<string>('');

  // Sync state
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncPhase, setSyncPhase] = useState<string>('');
  const [syncResult, setSyncResult] = useState<SyncTrainingResult | null>(null);
  const [userOffsetAdjustment, setUserOffsetAdjustment] = useState<number>(0);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [masterTime, setMasterTime] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [audioMode, setAudioMode] = useState<'both' | 'a' | 'b' | 'mute'>('both');

  // Export render state
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);

  // Video element refs
  const videoRefA = useRef<HTMLVideoElement>(null);
  const videoRefB = useRef<HTMLVideoElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number>(0);

  // Local object URLs for preview before / during sync
  const [previewUrlA, setPreviewUrlA] = useState<string>('');
  const [previewUrlB, setPreviewUrlB] = useState<string>('');

  // File input refs
  const fileInputRefA = useRef<HTMLInputElement>(null);
  const fileInputRefB = useRef<HTMLInputElement>(null);

  // Manage object URLs for memory efficiency
  useEffect(() => {
    if (fileA) {
      const url = URL.createObjectURL(fileA);
      setPreviewUrlA(url);
      return () => URL.revokeObjectURL(url);
    } else if (sampleFilenameA) {
      setPreviewUrlA(`${YOLO_API_BASE}/api/videos/${sampleFilenameA}`);
    } else if (syncResult?.video_a?.video_url) {
      setPreviewUrlA(syncResult.video_a.video_url);
    }
  }, [fileA, sampleFilenameA, syncResult?.video_a?.video_url]);

  useEffect(() => {
    if (fileB) {
      const url = URL.createObjectURL(fileB);
      setPreviewUrlB(url);
      return () => URL.revokeObjectURL(url);
    } else if (sampleFilenameB) {
      setPreviewUrlB(`${YOLO_API_BASE}/api/videos/${sampleFilenameB}`);
    } else if (syncResult?.video_b?.video_url) {
      setPreviewUrlB(syncResult.video_b.video_url);
    }
  }, [fileB, sampleFilenameB, syncResult?.video_b?.video_url]);

  // Custom dragged clap positions
  const [customClapA, setCustomClapA] = useState<number | null>(null);
  const [customClapB, setCustomClapB] = useState<number | null>(null);
  const [draggingClapTrack, setDraggingClapTrack] = useState<'a' | 'b' | null>(null);

  // Track container refs for calculating mouse/pointer coordinates
  const trackRefA = useRef<HTMLDivElement>(null);
  const trackRefB = useRef<HTMLDivElement>(null);

  // Derived multi-camera parameters
  const durationA = syncResult?.video_a?.duration || 30;
  const durationB = syncResult?.video_b?.duration || 30;

  // Effective claps (custom if dragged, otherwise auto-detected)
  const clapA = customClapA !== null ? customClapA : (syncResult?.video_a?.clap_time || 0);
  const clapB = customClapB !== null ? customClapB : (syncResult?.video_b?.clap_time || 0);

  // Start delays in Synced mode
  // If Camera A clapped at 5s and Camera B clapped at 2s:
  // Camera A ran 3s longer before the clap -> Camera A started 3s before Camera B.
  // In Synced mode: Camera A starts at 0, Camera B starts at 3s.
  const baseStartDelayA = clapA < clapB ? clapB - clapA : 0;
  const baseStartDelayB = clapB < clapA ? clapA - clapB : 0;

  // Apply fine-tuning user adjustment
  const effectiveDelayA = Math.max(0, baseStartDelayA - (userOffsetAdjustment < 0 ? Math.abs(userOffsetAdjustment) : 0));
  const effectiveDelayB = Math.max(0, baseStartDelayB + (userOffsetAdjustment > 0 ? userOffsetAdjustment : 0));

  const masterClapTime = Math.max(clapA, clapB);
  const totalMasterDuration = comparisonMode === 'synced'
    ? Math.max(effectiveDelayA + durationA, effectiveDelayB + durationB)
    : Math.max(durationA, durationB);

  const startedFirst = clapA > clapB ? 'video_a' : clapB > clapA ? 'video_b' : 'same_time';
  const startDifference = Math.abs(clapA - clapB);

  // Drag handler for setting custom clap on audiowave
  const handlePointerDownTrack = (track: 'a' | 'b', e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggingClapTrack(track);

    const targetEl = track === 'a' ? trackRefA.current : trackRefB.current;
    if (!targetEl) return;

    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {}

    const updateTimeFromPointer = (clientX: number) => {
      const rect = targetEl.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetDuration = track === 'a' ? durationA : durationB;
      const newClapTime = Math.round(ratio * targetDuration * 100) / 100;

      if (track === 'a') {
        setCustomClapA(newClapTime);
        if (videoRefA.current) videoRefA.current.currentTime = newClapTime;
        if (comparisonMode === 'synced') {
          const newMasterClap = Math.max(newClapTime, clapB);
          setMasterTime(newMasterClap);
          if (videoRefB.current) videoRefB.current.currentTime = clapB;
        } else {
          setMasterTime(newClapTime);
        }
      } else {
        setCustomClapB(newClapTime);
        if (videoRefB.current) videoRefB.current.currentTime = newClapTime;
        if (comparisonMode === 'synced') {
          const newMasterClap = Math.max(clapA, newClapTime);
          setMasterTime(newMasterClap);
          if (videoRefA.current) videoRefA.current.currentTime = clapA;
        } else {
          setMasterTime(newClapTime);
        }
      }
    };

    updateTimeFromPointer(e.clientX);

    const onPointerMove = (moveEvt: PointerEvent) => {
      updateTimeFromPointer(moveEvt.clientX);
    };

    const onPointerUp = (upEvt: PointerEvent) => {
      setDraggingClapTrack(null);
      try {
        (e.target as HTMLElement).releasePointerCapture?.(upEvt.pointerId);
      } catch {}
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  // Frame nudge handlers for Angle A and Angle B claps
  const nudgeClapA = (delta: number) => {
    const next = Math.max(0, Math.min(durationA, Math.round((clapA + delta) * 100) / 100));
    setCustomClapA(next);
    if (videoRefA.current) videoRefA.current.currentTime = next;
    if (comparisonMode === 'synced') {
      const newMasterClap = Math.max(next, clapB);
      setMasterTime(newMasterClap);
      if (videoRefB.current) videoRefB.current.currentTime = clapB;
    } else {
      setMasterTime(next);
    }
  };

  const nudgeClapB = (delta: number) => {
    const next = Math.max(0, Math.min(durationB, Math.round((clapB + delta) * 100) / 100));
    setCustomClapB(next);
    if (videoRefB.current) videoRefB.current.currentTime = next;
    if (comparisonMode === 'synced') {
      const newMasterClap = Math.max(clapA, next);
      setMasterTime(newMasterClap);
      if (videoRefA.current) videoRefA.current.currentTime = clapA;
    } else {
      setMasterTime(next);
    }
  };

  const resetClapA = () => {
    setCustomClapA(null);
    const autoClap = syncResult?.video_a?.clap_time || 0;
    if (videoRefA.current) videoRefA.current.currentTime = autoClap;
    if (comparisonMode === 'synced') {
      setMasterTime(Math.max(autoClap, clapB));
    }
    showToast('Reset Angle A clap to auto-detected');
  };

  const resetClapB = () => {
    setCustomClapB(null);
    const autoClap = syncResult?.video_b?.clap_time || 0;
    if (videoRefB.current) videoRefB.current.currentTime = autoClap;
    if (comparisonMode === 'synced') {
      setMasterTime(Math.max(clapA, autoClap));
    }
    showToast('Reset Angle B clap to auto-detected');
  };

  // Helper to sync video elements to master time
  const syncElements = useCallback((time: number) => {
    const vA = videoRefA.current;
    const vB = videoRefB.current;

    if (comparisonMode === 'synced') {
      // Synced Mode: feeds are offset so claps match
      if (vA) {
        if (time < effectiveDelayA) {
          // Camera A not started yet
          vA.currentTime = 0;
          if (!vA.paused) vA.pause();
        } else if (time <= effectiveDelayA + durationA) {
          const targetA = time - effectiveDelayA;
          if (Math.abs(vA.currentTime - targetA) > 0.18) {
            vA.currentTime = targetA;
          }
          if (isPlaying && vA.paused) vA.play().catch(() => {});
        } else {
          // Camera A feed ended
          vA.currentTime = durationA;
          if (!vA.paused) vA.pause();
        }
      }

      if (vB) {
        if (time < effectiveDelayB) {
          // Camera B not started yet
          vB.currentTime = 0;
          if (!vB.paused) vB.pause();
        } else if (time <= effectiveDelayB + durationB) {
          const targetB = time - effectiveDelayB;
          if (Math.abs(vB.currentTime - targetB) > 0.18) {
            vB.currentTime = targetB;
          }
          if (isPlaying && vB.paused) vB.play().catch(() => {});
        } else {
          // Camera B feed ended
          vB.currentTime = durationB;
          if (!vB.paused) vB.pause();
        }
      }
    } else {
      // Original Mode: Both start at 0:00 side-by-side
      if (vA) {
        if (time <= durationA) {
          if (Math.abs(vA.currentTime - time) > 0.18) {
            vA.currentTime = time;
          }
          if (isPlaying && vA.paused) vA.play().catch(() => {});
        } else {
          vA.currentTime = durationA;
          if (!vA.paused) vA.pause();
        }
      }

      if (vB) {
        if (time <= durationB) {
          if (Math.abs(vB.currentTime - time) > 0.18) {
            vB.currentTime = time;
          }
          if (isPlaying && vB.paused) vB.play().catch(() => {});
        } else {
          vB.currentTime = durationB;
          if (!vB.paused) vB.pause();
        }
      }
    }
  }, [comparisonMode, effectiveDelayA, effectiveDelayB, durationA, durationB, isPlaying]);

  // Unified animation loop for playback
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    lastTimestampRef.current = performance.now();

    const loop = (now: number) => {
      const dt = ((now - lastTimestampRef.current) / 1000) * playbackSpeed;
      lastTimestampRef.current = now;

      setMasterTime((prev) => {
        const nextTime = prev + dt;
        if (nextTime >= totalMasterDuration) {
          setIsPlaying(false);
          syncElements(totalMasterDuration);
          return totalMasterDuration;
        }
        syncElements(nextTime);
        return nextTime;
      });

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, playbackSpeed, totalMasterDuration, syncElements]);

  // Audio routing management
  useEffect(() => {
    if (videoRefA.current) {
      const isMutedByStandby = comparisonMode === 'synced' && (masterTime < effectiveDelayA || masterTime > effectiveDelayA + durationA);
      videoRefA.current.muted = isMutedByStandby || audioMode === 'mute' || audioMode === 'b';
    }
    if (videoRefB.current) {
      const isMutedByStandby = comparisonMode === 'synced' && (masterTime < effectiveDelayB || masterTime > effectiveDelayB + durationB);
      videoRefB.current.muted = isMutedByStandby || audioMode === 'mute' || audioMode === 'a';
    }
  }, [audioMode, masterTime, comparisonMode, effectiveDelayA, effectiveDelayB, durationA, durationB]);

  // Playback speed management
  useEffect(() => {
    if (videoRefA.current) videoRefA.current.playbackRate = playbackSpeed;
    if (videoRefB.current) videoRefB.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  // Unified Play / Pause
  const togglePlayPause = () => {
    if (isPlaying) {
      setIsPlaying(false);
      videoRefA.current?.pause();
      videoRefB.current?.pause();
    } else {
      if (masterTime >= totalMasterDuration) {
        setMasterTime(0);
        syncElements(0);
      } else {
        syncElements(masterTime);
      }
      setIsPlaying(true);
    }
  };

  // Unified Seek
  const handleSeek = (newTime: number) => {
    const clamped = Math.max(0, Math.min(totalMasterDuration, newTime));
    setMasterTime(clamped);
    syncElements(clamped);
  };

  // Nudge playback by delta seconds
  const nudgeTime = (delta: number) => {
    handleSeek(masterTime + delta);
  };

  // Jump to Clap moment
  const jumpToClap = () => {
    const target = comparisonMode === 'synced' ? masterClapTime : clapA;
    handleSeek(target);
  };

  // Quick Load Sample Videos
  const handleLoadSampleClips = () => {
    setFileA(null);
    setFileB(null);
    setSampleFilenameA('WhatsApp_Video_2026-10-13_at_11.38.22_AM_3d809995.mp4');
    setSampleFilenameB('WhatsApp_Video_2026-10-13_at_11.38.22_AM_a02c9029.mp4');
    showToast('Loaded sample multi-angle training drill footage');
  };

  // Execute Synchronization
  const handleRunSync = async () => {
    if (!fileA && !sampleFilenameA) {
      showToast('Please select or drop Video Angle A');
      return;
    }
    if (!fileB && !sampleFilenameB) {
      showToast('Please select or drop Video Angle B');
      return;
    }

    setIsSyncing(true);
    setSyncPhase('Extracting 16kHz audio streams from both video angles...');

    try {
      setTimeout(() => {
        setSyncPhase('Scanning audio from t=0 for first loudest clap sound...');
      }, 700);

      const result = await syncTrainingVideos({
        fileA: fileA || undefined,
        fileB: fileB || undefined,
        videoAFilename: !fileA ? sampleFilenameA : undefined,
        videoBFilename: !fileB ? sampleFilenameB : undefined,
      });

      setSyncPhase('Aligning multi-camera startup delay and duration timeline...');
      setSyncResult(result);
      setUserOffsetAdjustment(0);
      setMasterTime(0);
      setComparisonMode('synced');
      showToast(result.message || 'Videos synchronized successfully!');
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : 'Video synchronization failed.');
    } finally {
      setIsSyncing(false);
      setSyncPhase('');
    }
  };

  // Export Synced Side-by-Side MP4
  const handleExportSyncedVideo = async () => {
    if (!syncResult) return;
    setIsExporting(true);
    try {
      showToast('Rendering side-by-side composite video on server...');
      const res = await renderSyncedVideo({
        videoAFilename: syncResult.video_a.filename || 'angle_a.mp4',
        videoBFilename: syncResult.video_b.filename || 'angle_b.mp4',
        offsetSeconds: syncResult.offset_seconds + userOffsetAdjustment,
        startDelayA: effectiveDelayA,
        startDelayB: effectiveDelayB,
      });
      setExportedVideoUrl(res.synced_video_url);
      showToast('Side-by-side video rendered successfully!');
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : 'Render failed.');
    } finally {
      setIsExporting(false);
    }
  };

  // Helper to format seconds as MM:SS.ms
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // Status for Video A
  const isStandbyA = comparisonMode === 'synced' && masterTime < effectiveDelayA;
  const isEndedA = comparisonMode === 'synced'
    ? masterTime > effectiveDelayA + durationA
    : masterTime > durationA;

  // Status for Video B
  const isStandbyB = comparisonMode === 'synced' && masterTime < effectiveDelayB;
  const isEndedB = comparisonMode === 'synced'
    ? masterTime > effectiveDelayB + durationB
    : masterTime > durationB;

  // Clap flashing state
  const isClapA = comparisonMode === 'synced'
    ? Math.abs(masterTime - masterClapTime) < 0.25
    : Math.abs(masterTime - clapA) < 0.25;

  const isClapB = comparisonMode === 'synced'
    ? Math.abs(masterTime - masterClapTime) < 0.25
    : Math.abs(masterTime - clapB) < 0.25;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Header Card */}
      <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="p-1.5 rounded-lg bg-[#262626] text-white">
              <Clapperboard className="w-5 h-5 text-[#F7F4EE]" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#16A34A] bg-[#DCFCE7] px-2 py-0.5 rounded-full border border-[#BBF7D0]">
              Audio Transient Sync
            </span>
          </div>
          <h1 className="text-2xl font-black text-[#242424] tracking-tight">
            Sync Training Videos
          </h1>
          <p className="text-xs text-[#858585] mt-1 max-w-2xl leading-relaxed">
            Multi-camera training drill synchronization. One video will always start first and their lengths differ.
            The sync clap is automatically identified as the first loudest sound from the beginning of the video.
          </p>
        </div>

        {/* Quick Sample Clips / New Sync Button */}
        <div className="flex items-center gap-2">
          {!syncResult ? (
            <button
              onClick={handleLoadSampleClips}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#EEEBE3] text-[#242424] hover:bg-[#E2DDD2] border border-[#D9D3C5] transition-all flex items-center gap-2 shadow-2xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#16A34A]" />
              Load Sample Videos
            </button>
          ) : (
            <button
              onClick={() => {
                setSyncResult(null);
                setFileA(null);
                setFileB(null);
                setSampleFilenameA('');
                setSampleFilenameB('');
                setExportedVideoUrl(null);
                setIsPlaying(false);
              }}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#EEEBE3] text-[#242424] hover:bg-[#E2DDD2] border border-[#D9D3C5] transition-all flex items-center gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Sync New Pair
            </button>
          )}
        </div>
      </div>

      {/* STATE 1: UPLOAD / SELECTION VIEW (When no sync has been run yet) */}
      {!syncResult && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Camera Angle A Card */}
            <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[#E8E3D8] pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#262626] text-white flex items-center justify-center font-bold text-xs">
                    A
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#242424]">Camera Angle A</h3>
                    <p className="text-[11px] text-[#858585]">e.g. Sideline Tactical View</p>
                  </div>
                </div>
                {(fileA || sampleFilenameA) && (
                  <span className="text-[10px] font-semibold text-[#16A34A] bg-[#DCFCE7] px-2 py-0.5 rounded-full border border-[#BBF7D0]">
                    Ready
                  </span>
                )}
              </div>

              {/* Upload Dropzone */}
              <div
                onClick={() => fileInputRefA.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  fileA || sampleFilenameA
                    ? 'border-[#16A34A] bg-[#F0FDF4]/50'
                    : 'border-[#D9D3C5] hover:border-[#262626] bg-[#F7F4EE]/60'
                }`}
              >
                <input
                  ref={fileInputRefA}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      setFileA(e.target.files[0]);
                      setSampleFilenameA('');
                    }
                  }}
                />
                <FileVideo className="w-8 h-8 text-[#858585] mx-auto mb-2" />
                <p className="text-xs font-bold text-[#242424]">
                  {fileA ? fileA.name : sampleFilenameA ? sampleFilenameA : 'Upload Video Angle A'}
                </p>
                <p className="text-[10px] text-[#858585] mt-1">
                  Drag & drop MP4, MOV, or click to browse
                </p>
              </div>

              {/* Angle A mini preview if selected */}
              {previewUrlA && (
                <div className="relative rounded-xl overflow-hidden bg-black aspect-video border border-[#E8E3D8]">
                  <video
                    src={previewUrlA}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    controls={false}
                  />
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 text-white text-[10px] font-semibold">
                    Preview Angle A
                  </div>
                </div>
              )}
            </div>

            {/* Camera Angle B Card */}
            <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[#E8E3D8] pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#262626] text-white flex items-center justify-center font-bold text-xs">
                    B
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#242424]">Camera Angle B</h3>
                    <p className="text-[11px] text-[#858585]">e.g. Endzone / Behind Goal View</p>
                  </div>
                </div>
                {(fileB || sampleFilenameB) && (
                  <span className="text-[10px] font-semibold text-[#16A34A] bg-[#DCFCE7] px-2 py-0.5 rounded-full border border-[#BBF7D0]">
                    Ready
                  </span>
                )}
              </div>

              {/* Upload Dropzone */}
              <div
                onClick={() => fileInputRefB.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  fileB || sampleFilenameB
                    ? 'border-[#16A34A] bg-[#F0FDF4]/50'
                    : 'border-[#D9D3C5] hover:border-[#262626] bg-[#F7F4EE]/60'
                }`}
              >
                <input
                  ref={fileInputRefB}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      setFileB(e.target.files[0]);
                      setSampleFilenameB('');
                    }
                  }}
                />
                <FileVideo className="w-8 h-8 text-[#858585] mx-auto mb-2" />
                <p className="text-xs font-bold text-[#242424]">
                  {fileB ? fileB.name : sampleFilenameB ? sampleFilenameB : 'Upload Video Angle B'}
                </p>
                <p className="text-[10px] text-[#858585] mt-1">
                  Drag & drop MP4, MOV, or click to browse
                </p>
              </div>

              {/* Angle B mini preview if selected */}
              {previewUrlB && (
                <div className="relative rounded-xl overflow-hidden bg-black aspect-video border border-[#E8E3D8]">
                  <video
                    src={previewUrlB}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    controls={false}
                  />
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 text-white text-[10px] font-semibold">
                    Preview Angle B
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sync Trigger Action Card */}
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-6 text-center space-y-4">
            <div className="max-w-md mx-auto space-y-2">
              <h3 className="text-base font-bold text-[#242424]">
                Ready to Synchronize Video Feeds
              </h3>
              <p className="text-xs text-[#858585]">
                Our engine extracts audio waveforms, locates the first loudest sound (sync clap) from the beginning of each video,
                and aligns both angles side-by-side regardless of when each camera started recording.
              </p>
            </div>

            <button
              onClick={handleRunSync}
              disabled={isSyncing || (!fileA && !sampleFilenameA) || (!fileB && !sampleFilenameB)}
              className={`px-8 py-3 rounded-xl font-bold text-xs tracking-wider uppercase transition-all shadow-md flex items-center justify-center gap-2 mx-auto ${
                isSyncing || (!fileA && !sampleFilenameA) || (!fileB && !sampleFilenameB)
                  ? 'bg-[#E5E0D4] text-[#858585] cursor-not-allowed'
                  : 'bg-[#262626] text-white hover:bg-[#383838] active:scale-98'
              }`}
            >
              {isSyncing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{syncPhase || 'Synchronizing Feeds...'}</span>
                </>
              ) : (
                <>
                  <Clapperboard className="w-4 h-4 text-[#16A34A]" />
                  <span>Detect First Loudest Clap & Synchronize Feeds</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* STATE 2: SYNCHRONIZED COMPARISON & PREVIEW (After sync is processed) */}
      {syncResult && (
        <div className="space-y-6">
          {/* MULTI-CAMERA TIMELINE SUMMARY CARD */}
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#858585]">
                  Multi-Camera Recording Alignment
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#16A34A] border border-[#BBF7D0]">
                  {startedFirst === 'video_a'
                    ? `Camera A started ${startDifference.toFixed(2)}s earlier`
                    : startedFirst === 'video_b'
                    ? `Camera B started ${startDifference.toFixed(2)}s earlier`
                    : 'Cameras started simultaneously'}
                </span>
              </div>
              <p className="text-xs text-[#555555]">
                {syncResult.message}
              </p>
            </div>

            {/* Quick Jump to Clap Button */}
            <button
              onClick={jumpToClap}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-[#262626] text-white hover:bg-[#383838] transition-all flex items-center gap-1.5 shrink-0 shadow-xs active:scale-95"
            >
              <Zap className="w-3.5 h-3.5 text-[#FBBF24]" />
              <span>Jump to Clap ({formatTime(comparisonMode === 'synced' ? masterClapTime : clapA)})</span>
            </button>
          </div>

          {/* COMPARISON MODE SEGMENTED TOGGLE (Original vs Synced) */}
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#858585] block mb-1">
                Playback View Mode
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold text-[#242424]">
                  {comparisonMode === 'original'
                    ? 'Original (Unsynced) Side-by-Side'
                    : 'Synced (Clap-Aligned) Side-by-Side'}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  comparisonMode === 'original'
                    ? 'bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]'
                    : 'bg-[#DCFCE7] text-[#16A34A] border-[#BBF7D0]'
                }`}>
                  {comparisonMode === 'original'
                    ? 'Both start at 0:00 (Natural camera delay visible)'
                    : `Claps matched simultaneously at ${masterClapTime.toFixed(2)}s`}
                </span>
              </div>
            </div>

            {/* Segmented Pill Switch */}
            <div className="bg-[#EEEBE3] p-1 rounded-xl flex items-center border border-[#D9D3C5] shadow-inner">
              <button
                onClick={() => {
                  setComparisonMode('original');
                  setMasterTime(0);
                  syncElements(0);
                }}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                  comparisonMode === 'original'
                    ? 'bg-[#262626] text-white shadow-sm'
                    : 'text-[#6B7280] hover:text-[#242424]'
                }`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                Original (Unsynced)
              </button>
              <button
                onClick={() => {
                  setComparisonMode('synced');
                  setMasterTime(0);
                  syncElements(0);
                }}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                  comparisonMode === 'synced'
                    ? 'bg-[#262626] text-white shadow-sm'
                    : 'text-[#6B7280] hover:text-[#242424]'
                }`}
              >
                <Clapperboard className="w-3.5 h-3.5 text-[#16A34A]" />
                Synced (Clap-Aligned)
              </button>
            </div>
          </div>

          {/* DUAL VIDEO PLAYERS SIDE-BY-SIDE */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#262626] p-4 rounded-2xl shadow-lg border border-[#404040]">
            {/* Player A Container */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-white text-xs px-1">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-white/20 flex items-center justify-center font-bold text-[10px]">
                    A
                  </span>
                  <span className="font-semibold text-white/90 truncate max-w-[200px]">
                    {syncResult.video_a.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-white/60">
                  <span>Len: {durationA.toFixed(1)}s</span>
                  <span>&bull;</span>
                  <span className="text-[#4ADE80] font-semibold">Clap: {clapA.toFixed(2)}s</span>
                </div>
              </div>

              <div className={`relative rounded-xl overflow-hidden bg-black aspect-video border transition-all ${
                isClapA ? 'border-[#16A34A] ring-4 ring-[#16A34A]/50' : 'border-white/10'
              } shadow-inner`}>
                <video
                  ref={videoRefA}
                  src={previewUrlA}
                  className="w-full h-full object-contain"
                  playsInline
                  preload="auto"
                />

                {/* Badge top-left */}
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-xs text-white text-[10px] font-bold border border-white/20">
                  Angle A ({comparisonMode === 'synced' ? 'Clap-Aligned' : 'Original 0:00'})
                </div>

                {/* Standby overlay if Camera A has not started yet */}
                {isStandbyA && (
                  <div className="absolute inset-0 bg-black/85 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center">
                    <Clock className="w-8 h-8 text-[#D97706] mb-2 animate-pulse" />
                    <span className="text-xs font-bold text-white">Camera Angle A Standby</span>
                    <span className="text-[11px] text-[#D97706] font-semibold mt-0.5">
                      Starts recording in {(effectiveDelayA - masterTime).toFixed(1)}s
                    </span>
                    <span className="text-[10px] text-white/50 mt-2 max-w-xs">
                      Camera B was started first. Feed A begins at {effectiveDelayA.toFixed(1)}s.
                    </span>
                  </div>
                )}

                {/* Ended overlay if Camera A has finished */}
                {isEndedA && (
                  <div className="absolute bottom-2 right-2 px-2.5 py-1 rounded-md bg-black/80 backdrop-blur-xs text-white/80 text-[10px] font-bold border border-white/20">
                    Angle A Feed Completed ({durationA.toFixed(1)}s)
                  </div>
                )}

                {/* Clap Flash Moment */}
                {isClapA && (
                  <div className="absolute inset-0 border-4 border-[#16A34A] pointer-events-none animate-pulse flex items-center justify-center bg-[#16A34A]/10">
                    <span className="bg-[#16A34A] text-white text-xs font-black px-3 py-1.5 rounded-full shadow-xl">
                      👏 FIRST LOUDEST CLAP ({clapA.toFixed(2)}s)
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Player B Container */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-white text-xs px-1">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-white/20 flex items-center justify-center font-bold text-[10px]">
                    B
                  </span>
                  <span className="font-semibold text-white/90 truncate max-w-[200px]">
                    {syncResult.video_b.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-white/60">
                  <span>Len: {durationB.toFixed(1)}s</span>
                  <span>&bull;</span>
                  <span className="text-[#4ADE80] font-semibold">Clap: {clapB.toFixed(2)}s</span>
                </div>
              </div>

              <div className={`relative rounded-xl overflow-hidden bg-black aspect-video border transition-all ${
                isClapB ? 'border-[#16A34A] ring-4 ring-[#16A34A]/50' : 'border-white/10'
              } shadow-inner`}>
                <video
                  ref={videoRefB}
                  src={previewUrlB}
                  className="w-full h-full object-contain"
                  playsInline
                  preload="auto"
                />

                {/* Badge top-left */}
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-xs text-white text-[10px] font-bold border border-white/20">
                  Angle B ({comparisonMode === 'synced' ? 'Clap-Aligned' : 'Original 0:00'})
                </div>

                {/* Standby overlay if Camera B has not started yet */}
                {isStandbyB && (
                  <div className="absolute inset-0 bg-black/85 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center">
                    <Clock className="w-8 h-8 text-[#D97706] mb-2 animate-pulse" />
                    <span className="text-xs font-bold text-white">Camera Angle B Standby</span>
                    <span className="text-[11px] text-[#D97706] font-semibold mt-0.5">
                      Starts recording in {(effectiveDelayB - masterTime).toFixed(1)}s
                    </span>
                    <span className="text-[10px] text-white/50 mt-2 max-w-xs">
                      Camera A was started first. Feed B begins at {effectiveDelayB.toFixed(1)}s.
                    </span>
                  </div>
                )}

                {/* Ended overlay if Camera B has finished */}
                {isEndedB && (
                  <div className="absolute bottom-2 right-2 px-2.5 py-1 rounded-md bg-black/80 backdrop-blur-xs text-white/80 text-[10px] font-bold border border-white/20">
                    Angle B Feed Completed ({durationB.toFixed(1)}s)
                  </div>
                )}

                {/* Clap Flash Moment */}
                {isClapB && (
                  <div className="absolute inset-0 border-4 border-[#16A34A] pointer-events-none animate-pulse flex items-center justify-center bg-[#16A34A]/10">
                    <span className="bg-[#16A34A] text-white text-xs font-black px-3 py-1.5 rounded-full shadow-xl">
                      👏 FIRST LOUDEST CLAP ({clapB.toFixed(2)}s)
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* MASTER SYNCHRONIZED PLAYBACK CONTROLS */}
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm space-y-4">
            {/* Timeline Scrub Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono font-bold text-[#242424]">
                <span>{formatTime(masterTime)}</span>
                <span className="text-[11px] font-sans font-medium text-[#858585]">
                  {comparisonMode === 'synced' ? 'Synchronized Master Timeline' : 'Original Unsynced Playhead'}
                </span>
                <span>{formatTime(totalMasterDuration)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={totalMasterDuration}
                step={0.05}
                value={masterTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                className="w-full h-2 bg-[#E5E0D4] rounded-lg appearance-none cursor-pointer accent-[#262626]"
              />
            </div>

            {/* Audio Waveform Visualization Tracks with Custom Draggable Claps */}
            <div className="space-y-3 bg-[#F2EFE8] p-4 rounded-xl border border-[#E0DBD0]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] font-bold text-[#6B7280]">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-[#16A34A]" />
                  Interactive Audio Waveforms & Custom Clap Position
                </span>
                <span className="text-[10px] text-[#858585] flex items-center gap-1">
                  <GripVertical className="w-3 h-3 text-[#16A34A]" />
                  Drag the 👏 green pin on either waveform to custom set the clap
                </span>
              </div>

              {/* Waveform Track A */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-[#858585]">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#242424]">Angle A Waveform ({durationA.toFixed(1)}s)</span>
                    {customClapA !== null ? (
                      <span className="px-2 py-0.5 rounded bg-[#FEF3C7] text-[#D97706] font-bold text-[9px] border border-[#FDE68A] flex items-center gap-1">
                        <span>Custom Clap: {clapA.toFixed(2)}s</span>
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded bg-[#DCFCE7] text-[#16A34A] font-semibold text-[9px] border border-[#BBF7D0]">
                        Auto Clap: {clapA.toFixed(2)}s
                      </span>
                    )}

                    {/* Frame nudge buttons for Angle A */}
                    <div className="flex items-center gap-1 bg-[#E5E0D4] px-1 py-0.5 rounded-md">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          nudgeClapA(-0.05);
                        }}
                        className="px-1.5 py-0.5 rounded bg-[#FAF8F4] hover:bg-white text-[#242424] font-bold text-[9px] shadow-2xs"
                        title="Nudge Clap A -1 frame (-0.05s)"
                      >
                        -1f
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          nudgeClapA(0.05);
                        }}
                        className="px-1.5 py-0.5 rounded bg-[#FAF8F4] hover:bg-white text-[#242424] font-bold text-[9px] shadow-2xs"
                        title="Nudge Clap A +1 frame (+0.05s)"
                      >
                        +1f
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {customClapA !== null && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          resetClapA();
                        }}
                        className="text-[9px] text-[#858585] hover:text-[#242424] underline font-semibold flex items-center gap-0.5"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        Reset Auto
                      </button>
                    )}
                    <span className="text-[9px] text-[#858585]">
                      {draggingClapTrack === 'a' ? 'Dragging Clap A...' : 'Drag anchor or click waveform'}
                    </span>
                  </div>
                </div>

                <div
                  ref={trackRefA}
                  onPointerDown={(e) => handlePointerDownTrack('a', e)}
                  className={`relative h-12 bg-[#E5E0D4] rounded-lg overflow-visible flex items-end px-1 gap-px cursor-pointer select-none touch-none transition-all ${
                    draggingClapTrack === 'a'
                      ? 'ring-2 ring-[#16A34A] bg-[#DDD7C8] shadow-md'
                      : 'hover:ring-1 hover:ring-[#16A34A]/50'
                  }`}
                  title="Click or drag anywhere on waveform or drag the 👏 anchor to set Angle A clap"
                >
                  {/* Energy Bars */}
                  {syncResult.video_a.waveform?.map((val, idx) => (
                    <div
                      key={idx}
                      className="flex-1 bg-[#858585]/70 pointer-events-none transition-colors rounded-xs"
                      style={{ height: `${Math.max(10, val * 100)}%` }}
                    />
                  ))}

                  {/* Draggable Custom Clap Pin A */}
                  <div
                    className="absolute top-0 bottom-0 z-20 pointer-events-none"
                    style={{
                      left: `${Math.min(100, Math.max(0, (clapA / (durationA || 1)) * 100))}%`,
                    }}
                  >
                    {/* Full-height touch/grab hit box */}
                    <div className="absolute top-0 bottom-0 -left-3 w-6 pointer-events-auto cursor-grab active:cursor-grabbing select-none" />

                    {/* Vertical marker line */}
                    <div className="absolute top-0 bottom-0 -left-[1.5px] w-[3px] bg-[#16A34A] shadow-md rounded-full pointer-events-none" />

                    {/* Draggable Top Handle Badge (Centered) */}
                    <div
                      className={`absolute -top-4 left-0 -translate-x-1/2 px-2 py-0.5 rounded-md bg-[#16A34A] text-white text-[9px] font-black flex items-center gap-1 shadow-md cursor-grab active:cursor-grabbing pointer-events-auto select-none transition-transform whitespace-nowrap ${
                        draggingClapTrack === 'a' ? 'scale-110 ring-2 ring-white shadow-xl bg-[#15803D]' : 'hover:scale-105'
                      }`}
                      title="Drag to reposition Angle A clap anchor"
                    >
                      <GripVertical className="w-2.5 h-2.5 text-white/80" />
                      <span>👏 {clapA.toFixed(2)}s</span>
                    </div>

                    {/* Draggable Bottom Anchor Tab */}
                    <div
                      className={`absolute -bottom-1.5 left-0 -translate-x-1/2 w-3 h-3 bg-[#16A34A] rotate-45 rounded-xs shadow-md cursor-grab active:cursor-grabbing pointer-events-auto transition-transform ${
                        draggingClapTrack === 'a' ? 'scale-125 bg-[#15803D]' : 'hover:scale-110'
                      }`}
                      title="Angle A clap anchor base"
                    />
                  </div>

                  {/* Red Current Playhead Line A */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
                    style={{
                      left: `${Math.min(100, Math.max(0, (comparisonMode === 'synced'
                        ? Math.max(0, masterTime - effectiveDelayA)
                        : masterTime) / (durationA || 1) * 100))}%`,
                    }}
                  />
                </div>
              </div>

              {/* Waveform Track B */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[10px] text-[#858585]">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#242424]">Angle B Waveform ({durationB.toFixed(1)}s)</span>
                    {customClapB !== null ? (
                      <span className="px-2 py-0.5 rounded bg-[#FEF3C7] text-[#D97706] font-bold text-[9px] border border-[#FDE68A] flex items-center gap-1">
                        <span>Custom Clap: {clapB.toFixed(2)}s</span>
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded bg-[#DCFCE7] text-[#16A34A] font-semibold text-[9px] border border-[#BBF7D0]">
                        Auto Clap: {clapB.toFixed(2)}s
                      </span>
                    )}

                    {/* Frame nudge buttons for Angle B */}
                    <div className="flex items-center gap-1 bg-[#E5E0D4] px-1 py-0.5 rounded-md">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          nudgeClapB(-0.05);
                        }}
                        className="px-1.5 py-0.5 rounded bg-[#FAF8F4] hover:bg-white text-[#242424] font-bold text-[9px] shadow-2xs"
                        title="Nudge Clap B -1 frame (-0.05s)"
                      >
                        -1f
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          nudgeClapB(0.05);
                        }}
                        className="px-1.5 py-0.5 rounded bg-[#FAF8F4] hover:bg-white text-[#242424] font-bold text-[9px] shadow-2xs"
                        title="Nudge Clap B +1 frame (+0.05s)"
                      >
                        +1f
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {customClapB !== null && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          resetClapB();
                        }}
                        className="text-[9px] text-[#858585] hover:text-[#242424] underline font-semibold flex items-center gap-0.5"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        Reset Auto
                      </button>
                    )}
                    <span className="text-[9px] text-[#858585]">
                      {draggingClapTrack === 'b' ? 'Dragging Clap B...' : 'Drag anchor or click waveform'}
                    </span>
                  </div>
                </div>

                <div
                  ref={trackRefB}
                  onPointerDown={(e) => handlePointerDownTrack('b', e)}
                  className={`relative h-12 bg-[#E5E0D4] rounded-lg overflow-visible flex items-end px-1 gap-px cursor-pointer select-none touch-none transition-all ${
                    draggingClapTrack === 'b'
                      ? 'ring-2 ring-[#16A34A] bg-[#DDD7C8] shadow-md'
                      : 'hover:ring-1 hover:ring-[#16A34A]/50'
                  }`}
                  title="Click or drag anywhere on waveform or drag the 👏 anchor to set Angle B clap"
                >
                  {/* Energy Bars */}
                  {syncResult.video_b.waveform?.map((val, idx) => (
                    <div
                      key={idx}
                      className="flex-1 bg-[#858585]/70 pointer-events-none transition-colors rounded-xs"
                      style={{ height: `${Math.max(10, val * 100)}%` }}
                    />
                  ))}

                  {/* Draggable Custom Clap Pin B */}
                  <div
                    className="absolute top-0 bottom-0 z-20 pointer-events-none"
                    style={{
                      left: `${Math.min(100, Math.max(0, (clapB / (durationB || 1)) * 100))}%`,
                    }}
                  >
                    {/* Full-height touch/grab hit box */}
                    <div className="absolute top-0 bottom-0 -left-3 w-6 pointer-events-auto cursor-grab active:cursor-grabbing select-none" />

                    {/* Vertical marker line */}
                    <div className="absolute top-0 bottom-0 -left-[1.5px] w-[3px] bg-[#16A34A] shadow-md rounded-full pointer-events-none" />

                    {/* Draggable Top Handle Badge (Centered) */}
                    <div
                      className={`absolute -top-4 left-0 -translate-x-1/2 px-2 py-0.5 rounded-md bg-[#16A34A] text-white text-[9px] font-black flex items-center gap-1 shadow-md cursor-grab active:cursor-grabbing pointer-events-auto select-none transition-transform whitespace-nowrap ${
                        draggingClapTrack === 'b' ? 'scale-110 ring-2 ring-white shadow-xl bg-[#15803D]' : 'hover:scale-105'
                      }`}
                      title="Drag to reposition Angle B clap anchor"
                    >
                      <GripVertical className="w-2.5 h-2.5 text-white/80" />
                      <span>👏 {clapB.toFixed(2)}s</span>
                    </div>

                    {/* Draggable Bottom Anchor Tab */}
                    <div
                      className={`absolute -bottom-1.5 left-0 -translate-x-1/2 w-3 h-3 bg-[#16A34A] rotate-45 rounded-xs shadow-md cursor-grab active:cursor-grabbing pointer-events-auto transition-transform ${
                        draggingClapTrack === 'b' ? 'scale-125 bg-[#15803D]' : 'hover:scale-110'
                      }`}
                      title="Angle B clap anchor base"
                    />
                  </div>

                  {/* Red Current Playhead Line B */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
                    style={{
                      left: `${Math.min(100, Math.max(0, (comparisonMode === 'synced'
                        ? Math.max(0, masterTime - effectiveDelayB)
                        : masterTime) / (durationB || 1) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Controller Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[#E8E3D8]">
              {/* Playback Transport */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => nudgeTime(-1.0)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#EEEBE3] text-[#242424] hover:bg-[#E2DDD2] text-xs font-semibold"
                  title="Rewind 1 second"
                >
                  -1.0s
                </button>
                <button
                  onClick={() => nudgeTime(-0.1)}
                  className="px-2 py-1.5 rounded-lg bg-[#EEEBE3] text-[#242424] hover:bg-[#E2DDD2] text-xs font-semibold"
                  title="Rewind 1 frame (0.1s)"
                >
                  -1 Frame
                </button>

                <button
                  onClick={togglePlayPause}
                  className="w-10 h-10 rounded-xl bg-[#262626] text-white flex items-center justify-center hover:bg-[#383838] transition-all shadow-sm active:scale-95"
                >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                </button>

                <button
                  onClick={() => nudgeTime(0.1)}
                  className="px-2 py-1.5 rounded-lg bg-[#EEEBE3] text-[#242424] hover:bg-[#E2DDD2] text-xs font-semibold"
                  title="Forward 1 frame (0.1s)"
                >
                  +1 Frame
                </button>
                <button
                  onClick={() => nudgeTime(1.0)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#EEEBE3] text-[#242424] hover:bg-[#E2DDD2] text-xs font-semibold"
                  title="Forward 1 second"
                >
                  +1.0s
                </button>

                <button
                  onClick={jumpToClap}
                  className="px-3 py-1.5 rounded-lg bg-[#DCFCE7] text-[#16A34A] hover:bg-[#BBF7D0] border border-[#86EFAC] text-xs font-bold flex items-center gap-1 shadow-2xs"
                  title="Jump to sync clap moment"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Clap</span>
                </button>
              </div>

              {/* Speed Controller */}
              <div className="flex items-center gap-1.5 bg-[#EEEBE3] p-1 rounded-xl border border-[#D9D3C5]">
                <span className="text-[10px] font-bold text-[#858585] px-1.5">SPEED:</span>
                {[0.5, 1.0, 1.5, 2.0].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => setPlaybackSpeed(rate)}
                    className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
                      playbackSpeed === rate
                        ? 'bg-[#262626] text-white shadow-2xs'
                        : 'text-[#6B7280] hover:text-[#242424]'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              {/* Audio Source Selector */}
              <div className="flex items-center gap-1.5 bg-[#EEEBE3] p-1 rounded-xl border border-[#D9D3C5]">
                <span className="text-[10px] font-bold text-[#858585] px-1.5">AUDIO:</span>
                <button
                  onClick={() => setAudioMode('a')}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
                    audioMode === 'a'
                      ? 'bg-[#262626] text-white shadow-2xs'
                      : 'text-[#6B7280] hover:text-[#242424]'
                  }`}
                >
                  Angle A
                </button>
                <button
                  onClick={() => setAudioMode('b')}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
                    audioMode === 'b'
                      ? 'bg-[#262626] text-white shadow-2xs'
                      : 'text-[#6B7280] hover:text-[#242424]'
                  }`}
                >
                  Angle B
                </button>
                <button
                  onClick={() => setAudioMode('both')}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
                    audioMode === 'both'
                      ? 'bg-[#262626] text-white shadow-2xs'
                      : 'text-[#6B7280] hover:text-[#242424]'
                  }`}
                >
                  Both
                </button>
                <button
                  onClick={() => setAudioMode('mute')}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
                    audioMode === 'mute'
                      ? 'bg-[#262626] text-white shadow-2xs'
                      : 'text-[#6B7280] hover:text-[#242424]'
                  }`}
                >
                  <VolumeX className="w-3.5 h-3.5 inline" />
                </button>
              </div>
            </div>
          </div>

          {/* FINE-TUNE OFFSET & EXPORT CARD */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Fine-Tuning Card */}
            <div className="md:col-span-2 bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[#E8E3D8] pb-3">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-[#262626]" />
                  <h3 className="text-sm font-bold text-[#242424]">
                    Fine-Tune Temporal Offset
                  </h3>
                </div>
                <span className="text-xs font-mono font-bold text-[#16A34A] bg-[#DCFCE7] px-2 py-0.5 rounded-md border border-[#BBF7D0]">
                  {startedFirst === 'video_a'
                    ? `Camera A started ${startDifference.toFixed(3)}s earlier`
                    : startedFirst === 'video_b'
                    ? `Camera B started ${startDifference.toFixed(3)}s earlier`
                    : 'Cameras in sync'}
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-[#858585]">
                  <span>First Loudest Clap Onset:</span>
                  <span className="font-mono font-semibold text-[#242424]">
                    Angle A: {clapA.toFixed(2)}s &bull; Angle B: {clapB.toFixed(2)}s
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-[#858585]">
                  <span>Manual Micro-Adjustment:</span>
                  <span className="font-mono font-semibold text-[#242424]">
                    {userOffsetAdjustment >= 0 ? '+' : ''}{userOffsetAdjustment.toFixed(3)}s
                  </span>
                </div>

                {/* Nudge Buttons */}
                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={() => setUserOffsetAdjustment((prev) => Math.round((prev - 0.1) * 100) / 100)}
                    className="px-3 py-1.5 rounded-lg bg-[#EEEBE3] text-[#242424] hover:bg-[#E2DDD2] text-xs font-semibold"
                  >
                    -0.10s
                  </button>
                  <button
                    onClick={() => setUserOffsetAdjustment((prev) => Math.round((prev - 0.05) * 100) / 100)}
                    className="px-3 py-1.5 rounded-lg bg-[#EEEBE3] text-[#242424] hover:bg-[#E2DDD2] text-xs font-semibold"
                  >
                    -0.05s
                  </button>
                  <button
                    onClick={() => {
                      setUserOffsetAdjustment(0);
                      setCustomClapA(null);
                      setCustomClapB(null);
                      showToast('Reset claps & offset to auto-detected');
                    }}
                    className="flex-1 py-1.5 rounded-lg bg-[#EEEBE3] text-[#242424] hover:bg-[#E2DDD2] text-xs font-semibold text-center"
                  >
                    Reset to Auto Claps
                  </button>
                  <button
                    onClick={() => setUserOffsetAdjustment((prev) => Math.round((prev + 0.05) * 100) / 100)}
                    className="px-3 py-1.5 rounded-lg bg-[#EEEBE3] text-[#242424] hover:bg-[#E2DDD2] text-xs font-semibold"
                  >
                    +0.05s
                  </button>
                  <button
                    onClick={() => setUserOffsetAdjustment((prev) => Math.round((prev + 0.1) * 100) / 100)}
                    className="px-3 py-1.5 rounded-lg bg-[#EEEBE3] text-[#242424] hover:bg-[#E2DDD2] text-xs font-semibold"
                  >
                    +0.10s
                  </button>
                </div>
              </div>
            </div>

            {/* Export Render Card */}
            <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 border-b border-[#E8E3D8] pb-3 mb-3">
                  <Film className="w-4 h-4 text-[#262626]" />
                  <h3 className="text-sm font-bold text-[#242424]">
                    Composite Video Export
                  </h3>
                </div>
                <p className="text-xs text-[#858585] leading-relaxed">
                  Render a unified side-by-side MP4 combining both angles with audio synchronized at the first loudest clap.
                </p>
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleExportSyncedVideo}
                  disabled={isExporting}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-sm ${
                    isExporting
                      ? 'bg-[#E5E0D4] text-[#858585] cursor-not-allowed'
                      : 'bg-[#262626] text-white hover:bg-[#383838]'
                  }`}
                >
                  {isExporting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Rendering MP4...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 text-[#16A34A]" />
                      <span>Render Side-by-Side MP4</span>
                    </>
                  )}
                </button>

                {exportedVideoUrl && (
                  <a
                    href={exportedVideoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2 rounded-xl text-center text-xs font-bold text-[#16A34A] bg-[#DCFCE7] hover:bg-[#BBF7D0] border border-[#86EFAC] block transition-colors"
                  >
                    Open Rendered MP4 &darr;
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
