import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cpu,
  Download,
  Upload,
  RefreshCw,
  Sliders,
  Play,
  Film,
  Layers,
  Sparkles,
  CheckCircle2,
  ChevronRight,
  Clock,
  Video,
  RotateCcw,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { StatusBadge } from '@/components/common/StatusBadge';
import { TacticalVideoPlayer } from '@/components/common/TacticalVideoPlayer';
import { DetectionBox } from '@/types/football';
import {
  analyzeVideoWithYOLO,
  checkYOLOStatus,
  getBackgroundJobStatus,
  YOLOTimeline,
} from '@/lib/yoloApi';

export const AnalysisView: React.FC = () => {
  const {
    activeVideo,
    setActivePage,
    confidenceThreshold,
    setConfidenceThreshold,
    classConfidences,
    setClassConfidences,
    updateClassConfidence,
    activeBackgroundJob,
    setActiveBackgroundJob,
    analysisMode,
    setAnalysisMode,
    startBackgroundSession,
    showToast,
  } = useFootball();

  const [selectedChunkIndex, setSelectedChunkIndex] = useState<number>(0);
  const [playFullVideo, setPlayFullVideo] = useState<boolean>(false);
  const [isReannotating, setIsReannotating] = useState<boolean>(false);
  const chunkVideoRef = useRef<HTMLVideoElement>(null);

  // Model connection status
  const [modelStatus, setModelStatus] = useState<'checking' | 'ready' | 'offline'>('checking');
  const [modelName, setModelName] = useState<string>('best_5.onnx');

  // Real-time detection state updated during video playback
  const [liveDetections, setLiveDetections] = useState<DetectionBox[]>([]);
  const [liveClassCounts, setLiveClassCounts] = useState<{
    player: number;
    football: number;
    'football goal': number;
    'player with ball': number;
  }>({
    player: 0,
    football: 0,
    'football goal': 0,
    'player with ball': 0,
  });
  const [inferenceLatency, setInferenceLatency] = useState<number>(36);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState<boolean>(false);
  const [batchProgressMsg, setBatchProgressMsg] = useState<string | null>(null);
  const [timelineData, setTimelineData] = useState<YOLOTimeline | undefined>(
    activeVideo.timeline as YOLOTimeline | undefined
  );

  // Check YOLO backend connectivity
  useEffect(() => {
    let mounted = true;
    checkYOLOStatus().then((status) => {
      if (mounted) {
        if (status.ready) {
          setModelStatus('ready');
          if (status.model_file) {
            setModelName(status.model_file);
          }
        } else {
          setModelStatus('offline');
        }
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Update timeline if active video changes
  useEffect(() => {
    if (activeVideo.timeline) {
      setTimelineData(activeVideo.timeline as YOLOTimeline);
    }
  }, [activeVideo]);

  // Callback when TacticalVideoPlayer detects a frame
  const handleDetectionsUpdate = useCallback(
    (
      detections: DetectionBox[],
      counts: Record<string, number>,
      latencyMs: number
    ) => {
      setLiveDetections(detections);
      setLiveClassCounts({
        player: counts['player'] ?? 0,
        football: counts['football'] ?? (counts['ball'] ?? 0),
        'football goal': counts['football goal'] ?? (counts['goal'] ?? 0),
        'player with ball': counts['player with ball'] ?? 0,
      });
      if (latencyMs) setInferenceLatency(latencyMs);
    },
    []
  );

  // Polling for background annotation job updates
  useEffect(() => {
    if (
      !activeBackgroundJob ||
      activeBackgroundJob.status === 'completed' ||
      activeBackgroundJob.status === 'failed'
    ) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const updated = await getBackgroundJobStatus(activeBackgroundJob.job_id);
        if (updated) {
          setActiveBackgroundJob(updated);
        }
      } catch (err) {
        console.warn('Background job poll exception:', err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeBackgroundJob, setActiveBackgroundJob]);

  // Handle re-triggering background 5s chunked annotation
  const handleTriggerBackgroundAnnotation = async () => {
    setIsReannotating(true);
    setSelectedChunkIndex(0);
    setPlayFullVideo(false);
    try {
      showToast('Starting 5-second background annotation pipeline...');
      const job = await startBackgroundSession(activeVideo, classConfidences);
      if (job) {
        showToast('Background annotation started! First 5s subvideo will stream shortly.');
      }
    } catch (err) {
      console.error(err);
      showToast('Could not start background annotation.');
    } finally {
      setIsReannotating(false);
    }
  };

  // Auto-advance to next 5s chunk when current chunk finishes playing
  const handleChunkEnded = () => {
    if (!activeBackgroundJob?.chunks || activeBackgroundJob.chunks.length === 0) return;
    const nextIdx = selectedChunkIndex + 1;
    if (nextIdx < activeBackgroundJob.chunks.length) {
      setSelectedChunkIndex(nextIdx);
    } else if (activeBackgroundJob.status === 'completed' && activeBackgroundJob.full_video_url) {
      setPlayFullVideo(true);
    }
  };

  // Ensure video begins playing automatically as soon as a chunk finishes annotating
  useEffect(() => {
    if (chunkVideoRef.current) {
      const playPromise = chunkVideoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Autoplay caught browser interaction notice:', err);
        });
      }
    }
  }, [selectedChunkIndex, activeBackgroundJob?.chunks?.length, playFullVideo]);

  // Run full batch video analysis for smooth scrubbing
  const handleRunBatchAnalysis = async () => {
    if (isBatchAnalyzing) return;
    setIsBatchAnalyzing(true);
    setBatchProgressMsg('Sampling video frames & extracting YOLO detections...');

    try {
      const filename = activeVideo.filename;
      const res = await analyzeVideoWithYOLO(filename, 2.5, confidenceThreshold);
      if (res && res.success) {
        setTimelineData(res.timeline);
        setBatchProgressMsg(null);
        showToast(`Analyzed ${res.frames_analyzed} frames with model ${modelName}!`);
      }
    } catch (err: unknown) {
      setBatchProgressMsg(null);
      const errMsg = err instanceof Error ? err.message : 'Check video format';
      showToast(`Batch analysis notice: ${errMsg}`);
    } finally {
      setIsBatchAnalyzing(false);
    }
  };

  // Export detections JSON
  const handleExportJSON = () => {
    const payload = {
      model: modelName,
      session: activeVideo.matchName,
      video: activeVideo.filename,
      timestamp: new Date().toISOString(),
      confidence_threshold: confidenceThreshold,
      active_counts: liveClassCounts,
      current_detections: liveDetections,
      timeline: timelineData || null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yolo_analysis_${activeVideo.filename.replace(/\.[^/.]+$/, '')}.json`;
    a.click();
    showToast('Exported YOLO detections to JSON.');
  };

  // Compute average confidence
  const avgConfidence = liveDetections.length > 0
    ? (
        (liveDetections.reduce((sum, d) => sum + (d.confidence || 0), 0) /
          liveDetections.length) *
        100
      ).toFixed(1)
    : '0.0';

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* 1. UNIFIED PAGE HEADER */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-[#E8E3D8]">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-black text-[#242424] tracking-tight">
              Video Analysis
            </h1>
            <StatusBadge status={activeVideo.status} size="sm" />
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-[#858585]">
            <span className="text-[#242424] font-semibold">
              {activeVideo.matchName}
            </span>
            <span>•</span>
            <span className="font-mono">{activeVideo.filename}</span>
            <span>•</span>
            <span>{activeVideo.date}</span>
            <span>•</span>
            <span>{activeVideo.duration}</span>
          </div>
        </div>

        {/* Action Pills & Model Status */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <div className="px-3 py-1.5 rounded-xl bg-[#FAF8F4] border border-[#E8E3D8] text-xs text-[#404040] flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                modelStatus === 'ready'
                  ? 'bg-[#16A34A]'
                  : modelStatus === 'offline'
                  ? 'bg-[#DC2626]'
                  : 'bg-[#D97706] animate-pulse'
              }`}
            />
            <span className="font-medium">
              {modelStatus === 'ready'
                ? `Model: ${modelName} (Ready)`
                : modelStatus === 'offline'
                ? 'Backend Offline'
                : 'Connecting to Model...'}
            </span>
          </div>

          <button
            onClick={() => setActivePage('upload')}
            className="px-3 py-1.5 rounded-xl bg-[#FAF8F4] hover:bg-[#EEEBE3] border border-[#E8E3D8] text-xs font-semibold text-[#404040] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Upload another video"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Video</span>
          </button>
        </div>
      </div>

      {/* Play Video banner prompt */}
      {!isPlaying && (
        <div className="p-3.5 rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] flex items-center justify-between text-xs text-[#166534]">
          <div className="flex items-center gap-2.5">
            <Play className="w-4 h-4 fill-[#16A34A] text-[#16A34A] shrink-0" />
            <span className="font-medium">
              Click <strong>Play Video</strong> on the player below to start real-time YOLO frame analysis with synchronized class detection.
            </span>
          </div>
          <span className="text-[11px] font-mono font-bold text-[#15803D] hidden sm:inline">
            YOLOv11 • {modelName}
          </span>
        </div>
      )}

      {/* 2. UNIFIED MAIN WORKSPACE */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        {/* LEFT COLUMN: Large Tactical Video Player with Live Overlays OR 5s Progressive Chunk Stream */}
        <div className="xl:col-span-8 space-y-5">
          {/* ANALYSIS MODE SELECTOR */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2.5 rounded-2xl bg-[#FAF8F4] border border-[#E8E3D8]">
            <div className="flex items-center gap-1.5 bg-[#EEEBE3] p-1 rounded-xl">
              <button
                onClick={() => setAnalysisMode('live')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  analysisMode === 'live'
                    ? 'bg-[#262626] text-white shadow-2xs'
                    : 'text-[#666666] hover:text-[#242424]'
                }`}
              >
                <Play className="w-3.5 h-3.5" />
                <span>Live Canvas Player</span>
              </button>
              <button
                onClick={() => {
                  setAnalysisMode('chunked');
                  if (!activeBackgroundJob) {
                    handleTriggerBackgroundAnnotation();
                  }
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  analysisMode === 'chunked'
                    ? 'bg-[#16A34A] text-white shadow-2xs'
                    : 'text-[#666666] hover:text-[#242424]'
                }`}
              >
                <Film className="w-3.5 h-3.5 fill-white" />
                <span>5s Chunked Stream & Render</span>
              </button>
            </div>

            {analysisMode === 'chunked' && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-[#858585]">
                  {activeBackgroundJob?.status === 'completed'
                    ? `✓ Complete (${activeBackgroundJob.total_chunks} chunks)`
                    : activeBackgroundJob
                    ? `Chunk ${activeBackgroundJob.completed_chunks}/${activeBackgroundJob.total_chunks} (${activeBackgroundJob.progress_percent}%)`
                    : 'Ready to start'}
                </span>
                <button
                  onClick={handleTriggerBackgroundAnnotation}
                  disabled={isReannotating}
                  className="px-3 py-1.5 rounded-xl bg-[#262626] hover:bg-[#171717] text-white font-semibold flex items-center gap-1 text-xs cursor-pointer disabled:opacity-50"
                  title="Re-run background annotation with current class confidence thresholds"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isReannotating ? 'animate-spin' : ''}`} />
                  <span>Re-render</span>
                </button>
              </div>
            )}
          </div>

          {analysisMode === 'live' ? (
            /* MODE 1: LIVE CANVAS PLAYER */
            <>
              <TacticalVideoPlayer
                imageSrc={activeVideo.thumbnail || '/match_tactical_frame.jpg'}
                videoUrl={activeVideo.videoUrl || '/football_match_demo.mp4'}
                matchName={activeVideo.matchName}
                duration={activeVideo.duration}
                confidenceThreshold={confidenceThreshold}
                classConfidences={classConfidences}
                timeline={timelineData}
                modelName={modelName}
                showTimeline={true}
                onDetectionsUpdate={handleDetectionsUpdate}
                onPlayStateChange={setIsPlaying}
              />

              {/* Real-time Detections Stream Table */}
              <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#262626]" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424]">
                      Active Model Detections ({liveDetections.length})
                    </h4>
                  </div>
                  <span className="text-[11px] text-[#858585] font-mono">
                    Latency: {inferenceLatency}ms
                  </span>
                </div>

                {liveDetections.length === 0 ? (
                  <div className="py-6 text-center text-xs text-[#858585]">
                    <span>No detections at current threshold. Click Play to analyze video frames.</span>
                  </div>
                ) : (
                  <div className="max-h-52 overflow-y-auto divide-y divide-[#E8E3D8] text-xs">
                    {liveDetections.slice(0, 10).map((det, i) => (
                      <div
                        key={det.id || i}
                        className="py-2 px-1 flex items-center justify-between hover:bg-[#FBFAF7] rounded transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              det.class === 'player'
                                ? 'bg-[#2563EB]'
                                : det.class === 'football' || det.class === 'ball'
                                ? 'bg-[#D97706]'
                                : det.class === 'football goal' || det.class === 'goal'
                                ? 'bg-[#DC2626]'
                                : 'bg-[#059669]'
                            }`}
                          />
                          <span className="font-semibold text-[#242424] capitalize">
                            {det.class}
                          </span>
                          <span className="text-[11px] font-mono text-[#858585]">
                            ({det.x.toFixed(1)}%, {det.y.toFixed(1)}%)
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#16A34A]">
                            {((det.confidence || 0) * 100).toFixed(0)}% conf
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* MODE 2: 5S CHUNKED PROGRESSIVE STREAM & COMPLETE RENDERED VIDEO */
            <div className="space-y-4">
              {/* Progress and status banner */}
              {activeBackgroundJob?.status === 'processing' && (
                <div className="p-4 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] space-y-2">
                  <div className="flex items-center justify-between text-xs text-[#065F46] font-semibold">
                    <span className="flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#10B981]" />
                      <span>Partitioning & annotating in 5-second subvideos...</span>
                    </span>
                    <span className="font-mono font-bold">
                      Chunk {activeBackgroundJob.completed_chunks} of {activeBackgroundJob.total_chunks} ready ({activeBackgroundJob.progress_percent}%)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#D1FAE5] overflow-hidden">
                    <div
                      className="h-full bg-[#10B981] transition-all duration-500 rounded-full"
                      style={{ width: `${activeBackgroundJob.progress_percent}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[#047857]">
                    Streaming Segment {selectedChunkIndex + 1} now so you don&apos;t get bored while subsequent chunks render in background!
                  </p>
                </div>
              )}

              {activeBackgroundJob?.status === 'completed' && (
                <div className="p-4 rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#166534]">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
                    <div>
                      <span className="font-bold block">All 5-Second Subvideos Annotated Successfully!</span>
                      <span className="text-[11px] text-[#15803D]">
                        Total {activeBackgroundJob.chunks.length} chunks ({activeBackgroundJob.duration_sec}s). Full continuous video is ready.
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setPlayFullVideo(!playFullVideo)}
                      className={`px-3 py-1.5 rounded-xl font-bold transition-all text-xs flex items-center gap-1.5 cursor-pointer ${
                        playFullVideo
                          ? 'bg-[#16A34A] text-white shadow-2xs'
                          : 'bg-white border border-[#BBF7D0] text-[#166534] hover:bg-[#DCFCE7]'
                      }`}
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>{playFullVideo ? 'Playing Full Video' : 'Play Full Video'}</span>
                    </button>
                    {activeBackgroundJob.full_video_url && (
                      <a
                        href={activeBackgroundJob.full_video_url}
                        download={`annotated_${activeVideo.filename}`}
                        className="px-3 py-1.5 rounded-xl font-bold bg-[#262626] hover:bg-[#171717] text-white transition-all text-xs flex items-center gap-1.5 shadow-2xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download MP4</span>
                      </a>
                    )}
                  </div>
                </div>
              )}

              {!activeBackgroundJob && (
                <div className="p-8 rounded-3xl bg-[#FAF8F4] border border-[#E8E3D8] text-center space-y-3">
                  <Film className="w-10 h-10 text-[#16A34A] mx-auto" />
                  <h4 className="text-base font-bold text-[#242424]">Start 5-Second Background Annotation</h4>
                  <p className="text-xs text-[#858585] max-w-md mx-auto">
                    Partition this video into 5s subvideos with per-class confidence filtering (Football Goal 35%, Football 30%, Player 25%).
                  </p>
                  <button
                    onClick={handleTriggerBackgroundAnnotation}
                    disabled={isReannotating}
                    className="px-5 py-2.5 rounded-xl bg-[#16A34A] hover:bg-[#15803D] text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer shadow-xs"
                  >
                    <Film className="w-4 h-4 fill-white" />
                    <span>Start 5s Background Annotation</span>
                  </button>
                </div>
              )}

              {/* While Chunk 1 is currently annotating in background */}
              {activeBackgroundJob && (!activeBackgroundJob.chunks || activeBackgroundJob.chunks.length === 0) && (
                <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border border-[#262626] shadow-md flex items-center justify-center">
                  {activeVideo.videoUrl ? (
                    <video
                      src={activeVideo.videoUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-full h-full object-contain opacity-50"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-[#171717]">
                      <Film className="w-12 h-12 text-[#16A34A] animate-pulse" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center text-center p-6 space-y-3">
                    <RefreshCw className="w-10 h-10 text-[#10B981] animate-spin" />
                    <div>
                      <h4 className="text-base font-bold text-white">
                        Annotating 5-Second Segment 1 in Background...
                      </h4>
                      <p className="text-xs text-[#D4D4D4] max-w-md mt-1">
                        Processing &quot;{activeVideo.matchName}&quot;. Playback will begin automatically the moment Segment 1 is ready!
                      </p>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#10B981]/20 border border-[#10B981]/30 text-[#10B981] text-xs font-mono font-bold">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Ready shortly • Subsequent chunks will queue automatically</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Subvideo Player */}
              {activeBackgroundJob && activeBackgroundJob.chunks && activeBackgroundJob.chunks.length > 0 && (
                <>
                  <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border border-[#262626] shadow-md flex items-center justify-center">
                    <video
                      ref={chunkVideoRef}
                      key={playFullVideo ? 'full-video' : `chunk-${selectedChunkIndex}`}
                      src={
                        playFullVideo
                          ? activeBackgroundJob.full_video_url || activeBackgroundJob.chunks[0].video_url
                          : activeBackgroundJob.chunks[selectedChunkIndex]?.video_url
                      }
                      controls
                      autoPlay
                      playsInline
                      onEnded={handleChunkEnded}
                      className="w-full h-full object-contain"
                    />
                  </div>

                  {/* 5-Second Subvideo Segment Track / Playlist */}
                  <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[#E8E3D8]">
                      <div className="flex items-center gap-2">
                        <Film className="w-4 h-4 text-[#16A34A]" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424]">
                          5-Second Subvideo Segments ({activeBackgroundJob.chunks.length}/{activeBackgroundJob.total_chunks})
                        </h4>
                      </div>
                      <span className="text-[11px] text-[#858585] font-mono">
                        Auto-advances to next segment
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                      {activeBackgroundJob.chunks.map((chunk, idx) => {
                        const isCurrent = !playFullVideo && selectedChunkIndex === idx;
                        return (
                          <button
                            key={chunk.chunk_index}
                            onClick={() => {
                              setPlayFullVideo(false);
                              setSelectedChunkIndex(idx);
                            }}
                            className={`p-2.5 rounded-xl text-left transition-all border cursor-pointer ${
                              isCurrent
                                ? 'bg-[#16A34A] text-white border-[#15803D] shadow-xs'
                                : 'bg-white hover:bg-[#F5F2EB] text-[#242424] border-[#E8E3D8]'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold">
                                Chunk {idx + 1}
                              </span>
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                  isCurrent
                                    ? 'bg-white/20 text-white'
                                    : 'bg-[#EEEBE3] text-[#555555]'
                                }`}
                              >
                                {chunk.start_time.toFixed(1)}s - {chunk.end_time.toFixed(1)}s
                              </span>
                            </div>
                            <div
                              className={`text-[10px] truncate ${
                                isCurrent ? 'text-white/80' : 'text-[#858585]'
                              }`}
                            >
                              Players: {chunk.counts?.player || 0} • Goal: {chunk.counts?.['football goal'] || 0}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Detected Classes, Model Confidence & Controls */}
        <div className="xl:col-span-4 space-y-5">
          {/* A. DETECTED CLASSES CARD */}
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-2xs">
            <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424] flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#262626]" />
                <span>Detected Classes</span>
              </h4>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#262626] text-white font-mono font-bold">
                {liveDetections.length} Total
              </span>
            </div>

            <p className="text-[11px] text-[#858585] mt-2 mb-3">
              Predictions from trained YOLO model (<strong className="text-[#242424]">{modelName}</strong>) updated dynamically with video playback.
            </p>

            <div className="divide-y divide-[#E8E3D8] text-xs">
              {/* 1. Players */}
              <div className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-3.5 h-3.5 rounded-full bg-[#2563EB] shadow-xs" />
                  <div>
                    <span className="font-bold text-[#242424] block">Players</span>
                    <span className="text-[10px] text-[#858585]">Class 2: player</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-lg text-[#2563EB]">
                    {liveClassCounts.player}
                  </span>
                </div>
              </div>

              {/* 2. Football */}
              <div className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-3.5 h-3.5 rounded-full bg-[#D97706] shadow-xs" />
                  <div>
                    <span className="font-bold text-[#242424] block">Football</span>
                    <span className="text-[10px] text-[#858585]">Class 0: football</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-lg text-[#D97706]">
                    {liveClassCounts.football}
                  </span>
                </div>
              </div>

              {/* 3. Football Goal */}
              <div className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-3.5 h-3.5 rounded-full bg-[#DC2626] shadow-xs" />
                  <div>
                    <span className="font-bold text-[#242424] block">Football Goal</span>
                    <span className="text-[10px] text-[#858585]">Class 1: football goal</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-lg text-[#DC2626]">
                    {liveClassCounts['football goal']}
                  </span>
                </div>
              </div>

              {/* 4. Player with Ball */}
              <div className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-3.5 h-3.5 rounded-full bg-[#059669] shadow-xs" />
                  <div>
                    <span className="font-bold text-[#242424] block">Player with Ball</span>
                    <span className="text-[10px] text-[#858585]">Class 3: player with ball</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-lg text-[#059669]">
                    {liveClassCounts['player with ball']}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* B. CLASS-SPECIFIC CONFIDENCE FILTERS */}
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424] flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#262626]" />
                <span>Class Confidence Thresholds</span>
              </h4>
              <button
                onClick={() => {
                  setClassConfidences({
                    football: 0.3,
                    'football goal': 0.35,
                    player: 0.25,
                    'player with ball': 0.25,
                  });
                  showToast('Reset to recommended thresholds (Goal 35%, Football 30%, Player 25%)');
                }}
                className="flex items-center gap-1 text-[11px] text-[#858585] hover:text-[#242424] font-medium cursor-pointer transition-colors"
                title="Reset to recommended baseline"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Defaults</span>
              </button>
            </div>

            <p className="text-[11px] text-[#858585] leading-relaxed">
              Fine-tune separate detection thresholds per class. Candidate detections below their specific threshold are immediately discarded.
            </p>

            <div className="space-y-3.5">
              {/* 1. Football Goal */}
              <div className="p-3 rounded-xl bg-white border border-[#E8E3D8] space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" />
                    <span className="font-bold text-[#242424]">Football Goal</span>
                    <span className="text-[10px] text-[#858585]">Class 1</span>
                  </div>
                  <span className="font-mono font-bold text-xs text-[#DC2626] bg-[#DC2626]/10 px-2 py-0.5 rounded">
                    {Math.round((classConfidences['football goal'] ?? 0.35) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.05"
                  value={classConfidences['football goal'] ?? 0.35}
                  onChange={(e) => updateClassConfidence('football goal', parseFloat(e.target.value))}
                  className="w-full accent-[#DC2626] h-1.5 bg-[#E8E3D8] rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#858585] font-mono">
                  <span>5% (Permissive)</span>
                  <span className="font-semibold text-[#DC2626]">Recommended: 35%</span>
                  <span>95% (Strict)</span>
                </div>
              </div>

              {/* 2. Football */}
              <div className="p-3 rounded-xl bg-white border border-[#E8E3D8] space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#D97706]" />
                    <span className="font-bold text-[#242424]">Football (Ball)</span>
                    <span className="text-[10px] text-[#858585]">Class 0</span>
                  </div>
                  <span className="font-mono font-bold text-xs text-[#D97706] bg-[#D97706]/10 px-2 py-0.5 rounded">
                    {Math.round((classConfidences['football'] ?? 0.3) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.05"
                  value={classConfidences['football'] ?? 0.3}
                  onChange={(e) => updateClassConfidence('football', parseFloat(e.target.value))}
                  className="w-full accent-[#D97706] h-1.5 bg-[#E8E3D8] rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#858585] font-mono">
                  <span>5% (Permissive)</span>
                  <span className="font-semibold text-[#D97706]">Recommended: 30%</span>
                  <span>95% (Strict)</span>
                </div>
              </div>

              {/* 3. Player */}
              <div className="p-3 rounded-xl bg-white border border-[#E8E3D8] space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]" />
                    <span className="font-bold text-[#242424]">Player</span>
                    <span className="text-[10px] text-[#858585]">Class 2</span>
                  </div>
                  <span className="font-mono font-bold text-xs text-[#2563EB] bg-[#2563EB]/10 px-2 py-0.5 rounded">
                    {Math.round((classConfidences['player'] ?? 0.25) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.05"
                  value={classConfidences['player'] ?? 0.25}
                  onChange={(e) => updateClassConfidence('player', parseFloat(e.target.value))}
                  className="w-full accent-[#2563EB] h-1.5 bg-[#E8E3D8] rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#858585] font-mono">
                  <span>5% (Permissive)</span>
                  <span className="font-semibold text-[#2563EB]">Recommended: 25%</span>
                  <span>95% (Strict)</span>
                </div>
              </div>

              {/* 4. Player with Ball */}
              <div className="p-3 rounded-xl bg-white border border-[#E8E3D8] space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#059669]" />
                    <span className="font-bold text-[#242424]">Player with Ball</span>
                    <span className="text-[10px] text-[#858585]">Class 3</span>
                  </div>
                  <span className="font-mono font-bold text-xs text-[#059669] bg-[#059669]/10 px-2 py-0.5 rounded">
                    {Math.round((classConfidences['player with ball'] ?? 0.25) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.05"
                  value={classConfidences['player with ball'] ?? 0.25}
                  onChange={(e) => updateClassConfidence('player with ball', parseFloat(e.target.value))}
                  className="w-full accent-[#059669] h-1.5 bg-[#E8E3D8] rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#858585] font-mono">
                  <span>5% (Permissive)</span>
                  <span className="font-semibold text-[#059669]">Recommended: 25%</span>
                  <span>95% (Strict)</span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-[#E8E3D8]">
              <button
                onClick={() => {
                  setAnalysisMode('chunked');
                  handleTriggerBackgroundAnnotation();
                }}
                disabled={isReannotating}
                className="w-full py-2.5 px-3 rounded-xl bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-50 text-white text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isReannotating ? 'animate-spin' : ''}`} />
                <span>
                  {isReannotating ? 'Rendering 5s Subvideos...' : 'Apply & Render 5s Subvideos'}
                </span>
              </button>
            </div>
          </div>

          {/* C. MODEL CONFIDENCE & CONTROLS */}
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424] flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#262626]" />
                <span>Model Confidence</span>
              </h4>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#16A34A]/10 text-[#16A34A] font-bold border border-[#16A34A]/30">
                ACTIVE
              </span>
            </div>

            {/* Circular Confidence Meter */}
            <div className="flex items-center justify-center py-1">
              <div className="relative w-32 h-32 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="transparent"
                    stroke="#E8E3D8"
                    strokeWidth="8"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="transparent"
                    stroke="#262626"
                    strokeWidth="8"
                    strokeDasharray="251"
                    strokeDashoffset={`${251 - (251 * parseFloat(avgConfidence)) / 100}`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-xl font-black text-[#242424]">
                    {avgConfidence}%
                  </span>
                  <span className="text-[9px] text-[#858585] font-semibold">
                    Mean Confidence
                  </span>
                </div>
              </div>
            </div>

            {/* Threshold Slider */}
            <div className="space-y-1.5 pt-2 border-t border-[#E8E3D8]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#858585]">Confidence Threshold:</span>
                <span className="font-mono font-bold text-[#262626]">
                  {confidenceThreshold.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.10"
                max="0.90"
                step="0.05"
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                className="w-full accent-[#262626] h-1.5 bg-[#E8E3D8] rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-[#858585] font-mono">
                <span>0.10 (High Recall)</span>
                <span>0.90 (High Precision)</span>
              </div>
            </div>

            {/* Specs List */}
            <div className="space-y-2 text-xs pt-2 border-t border-[#E8E3D8]">
              <div className="flex items-center justify-between text-[#858585]">
                <span>Trained Model:</span>
                <span className="font-mono font-bold text-[#242424]">{modelName}</span>
              </div>

              <div className="flex items-center justify-between text-[#858585]">
                <span>Architecture:</span>
                <span className="font-semibold text-[#242424]">YOLOv11 Detection</span>
              </div>

              <div className="flex items-center justify-between text-[#858585]">
                <span>Frame Latency:</span>
                <span className="font-mono font-bold text-[#16A34A]">
                  {inferenceLatency}ms
                </span>
              </div>

              <div className="flex items-center justify-between text-[#858585]">
                <span>Target Resolution:</span>
                <span className="font-mono text-[#242424]">640x640 / 1080p</span>
              </div>
            </div>

            {/* Buttons: Batch Pre-Analysis & Export */}
            <div className="pt-2 border-t border-[#E8E3D8] space-y-2">
              <button
                onClick={handleRunBatchAnalysis}
                disabled={isBatchAnalyzing}
                className="w-full py-2.5 px-3 rounded-xl bg-[#262626] hover:bg-[#171717] disabled:bg-[#858585] text-white text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                {isBatchAnalyzing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Analyzing Frames...</span>
                  </>
                ) : (
                  <>
                    <Film className="w-3.5 h-3.5" />
                    <span>Analyze Full Video</span>
                  </>
                )}
              </button>

              <button
                onClick={handleExportJSON}
                className="w-full py-2 px-3 rounded-xl bg-[#FAF8F4] hover:bg-[#EEEBE3] border border-[#E8E3D8] text-[#404040] text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Detections (JSON)</span>
              </button>

              {batchProgressMsg && (
                <div className="p-2 rounded-lg bg-[#EEEBE3] text-[11px] text-[#404040] font-mono text-center">
                  {batchProgressMsg}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. KEY MATCH & DETECTION METRICS */}
      <div className="space-y-4 pt-4 border-t border-[#E8E3D8]">
        <div className="flex items-center gap-4">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#858585] whitespace-nowrap">
            Tactical & Model Metrics
          </span>
          <div className="flex-1 h-px bg-[#E8E3D8]" />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-xl p-5 shadow-2xs">
            <span className="text-xs text-[#858585] font-medium block">
              Players on Pitch
            </span>
            <span className="text-2xl font-black mt-1 block text-[#2563EB]">
              {liveClassCounts.player}
            </span>
            <span className="text-[11px] text-[#858585] mt-1 block">
              YOLO bounding boxes
            </span>
          </div>

          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-xl p-5 shadow-2xs">
            <span className="text-xs text-[#858585] font-medium block">
              Ball Tracking
            </span>
            <span className="text-2xl font-black mt-1 block text-[#D97706]">
              {liveClassCounts.football > 0 ? 'Detected' : 'Searching'}
            </span>
            <span className="text-[11px] text-[#858585] mt-1 block">
              {liveClassCounts.football} active footballs
            </span>
          </div>

          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-xl p-5 shadow-2xs">
            <span className="text-xs text-[#858585] font-medium block">
              Goals in View
            </span>
            <span className="text-2xl font-black mt-1 block text-[#DC2626]">
              {liveClassCounts['football goal']}
            </span>
            <span className="text-[11px] text-[#858585] mt-1 block">
              Goalpost detection
            </span>
          </div>

          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-xl p-5 shadow-2xs">
            <span className="text-xs text-[#858585] font-medium block">
              Possession Carrier
            </span>
            <span className="text-2xl font-black mt-1 block text-[#059669]">
              {liveClassCounts['player with ball'] > 0 ? 'Active' : 'Pass in Flight'}
            </span>
            <span className="text-[11px] text-[#858585] mt-1 block">
              Class: player with ball
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
