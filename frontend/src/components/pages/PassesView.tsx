'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Film,
  FileVideo,
  Play,
  RefreshCw,
  Share2,
  Video,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { MatchVideo } from '@/types/football';
import {
  BackgroundAnnotationJob,
  PassEvent,
  getBackgroundJobStatus,
} from '@/lib/yoloApi';

const STORAGE_KEY = 'passesJobs:v1'; // sessionId -> jobId
const POLL_MS = 1500;
const PITCH_L = 105;
const PITCH_W = 68;
const HIGHLIGHT_SEC = 2.5; // how long a completed pass stays highlighted in 2D

interface NumberedPass extends PassEvent {
  number: number;
  chunk: number;
}

function readJobMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeJobMap(map: Record<string, string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable: the job just won't be remembered after a reload */
  }
}

/** Pass endpoints in pitch metres (calibrated) or the frame plane scaled to the pitch. */
function passPoints(p: PassEvent): { from: [number, number]; to: [number, number] } {
  if (p.from_pitch && p.to_pitch) return { from: p.from_pitch, to: p.to_pitch };
  return {
    from: [p.from_xy[0] * PITCH_L, p.from_xy[1] * PITCH_W],
    to: [p.to_xy[0] * PITCH_L, p.to_xy[1] * PITCH_W],
  };
}

export const PassesView: React.FC = () => {
  const {
    videos,
    passesSessionId,
    setPassesSessionId,
    passesAutoStart,
    setPassesAutoStart,
    startPassDetectionJob,
    setActivePage,
  } = useFootball();

  const session: MatchVideo | undefined =
    videos.find((v) => v.id === passesSessionId) ?? videos[0];

  const [jobMap, setJobMap] = useState<Record<string, string>>(readJobMap);
  const [job, setJob] = useState<BackgroundAnnotationJob | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const jobId = session ? jobMap[session.id] : undefined;

  const rememberJob = useCallback((sessionId: string, id: string | null) => {
    setJobMap((prev) => {
      const next = { ...prev };
      if (id) next[sessionId] = id;
      else delete next[sessionId];
      writeJobMap(next);
      return next;
    });
  }, []);

  const startDetection = useCallback(async () => {
    if (!session) return;
    setIsStarting(true);
    setStartError(null);
    setJob(null);
    try {
      const started = await startPassDetectionJob(session);
      rememberJob(session.id, started.job_id);
      setJob(started);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Could not start pass detection.');
    } finally {
      setIsStarting(false);
    }
  }, [rememberJob, session, startPassDetectionJob]);

  // "Detect Passes" on the Upload page: start a job unless this session already has one.
  useEffect(() => {
    if (!passesAutoStart || !session) return;
    setPassesAutoStart(false);
    if (!jobId) void startDetection();
  }, [jobId, passesAutoStart, session, setPassesAutoStart, startDetection]);

  // Poll the job until it finishes. A job lost by a backend restart is forgotten.
  useEffect(() => {
    if (!jobId || !session) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const latest = await getBackgroundJobStatus(jobId);
        if (cancelled) return;
        setStartError(null);
        setJob(latest);
        if (latest.status === 'processing') timer = setTimeout(tick, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (/404|not found/i.test(msg)) {
          rememberJob(session.id, null);
          setJob(null);
          setStartError(
            'The previous pass-detection job is no longer on the analytics server (it may have restarted). Run it again.'
          );
        } else {
          setStartError(`Lost connection to the analytics server: ${msg}`);
          timer = setTimeout(tick, POLL_MS * 2);
        }
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, rememberJob, session]);

  const currentJob = job && job.job_id === jobId ? job : null;

  const passes: NumberedPass[] = useMemo(() => {
    const out: NumberedPass[] = [];
    (currentJob?.chunks ?? []).forEach((c) =>
      (c.pass_events ?? []).forEach((p) =>
        out.push({ ...p, number: out.length + 1, chunk: c.chunk_index + 1 })
      )
    );
    return out;
  }, [currentJob]);

  /* ---------- video playback, synced to the 2D view ---------- */
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [chunkIdx, setChunkIdx] = useState(0);
  const [playFull, setPlayFull] = useState(false);
  const [playTime, setPlayTime] = useState(0); // seconds in the full video
  const [showHistory, setShowHistory] = useState(true);

  const chunks = currentJob?.chunks ?? [];
  const activeChunk = chunks[Math.min(chunkIdx, Math.max(0, chunks.length - 1))];
  const videoSrc = playFull ? currentJob?.full_video_url : activeChunk?.video_url;
  const timeOffset = playFull ? 0 : (activeChunk?.start_time ?? 0);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const v = videoRef.current;
      if (v) {
        const t = timeOffset + v.currentTime;
        setPlayTime((prev) => (Math.abs(prev - t) > 0.04 ? t : prev));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [timeOffset, videoSrc]);

  const seekTo = (globalSec: number) => {
    const target = Math.max(0, globalSec);
    if (playFull && currentJob?.full_video_url) {
      if (videoRef.current) videoRef.current.currentTime = target;
      return;
    }
    const idx = chunks.findIndex((c) => target >= c.start_time && target < c.end_time);
    const nextIdx = idx >= 0 ? idx : chunks.length - 1;
    const local = target - (chunks[nextIdx]?.start_time ?? 0);
    if (nextIdx === chunkIdx && videoRef.current) {
      videoRef.current.currentTime = local;
      void videoRef.current.play().catch(() => undefined);
    } else {
      pendingSeek.current = local;
      setChunkIdx(nextIdx);
    }
  };

  const onLoaded = () => {
    if (pendingSeek.current != null && videoRef.current) {
      videoRef.current.currentTime = pendingSeek.current;
      pendingSeek.current = null;
    }
  };

  const onEnded = () => {
    if (!playFull && chunkIdx + 1 < chunks.length) setChunkIdx(chunkIdx + 1);
  };

  const passesSoFar = passes.filter((p) => p.end_time <= playTime).length;
  const calibrated = passes.some((p) => p.from_pitch);

  /* ---------- render ---------- */
  if (videos.length === 0) {
    return (
      <div className="py-16 text-center flex flex-col items-center">
        <FileVideo className="w-10 h-10 text-[#858585] mb-3" />
        <h3 className="text-base font-bold text-[#242424]">No sessions yet</h3>
        <p className="text-xs text-[#858585] mt-1">Upload a football session first, then detect its passes here.</p>
        <button
          onClick={() => setActivePage('upload')}
          className="mt-4 px-4 py-2 rounded-xl bg-[#262626] text-white text-xs font-bold cursor-pointer"
        >
          Go to Upload Video
        </button>
      </div>
    );
  }

  const processing = isStarting || currentJob?.status === 'processing';

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h3 className="text-xl sm:text-2xl font-black text-[#242424] tracking-tight flex items-center gap-2">
            <Share2 className="w-6 h-6 text-[#2563EB]" /> Passes
          </h3>
          <p className="text-xs sm:text-sm text-[#858585] mt-1">
            Splits the session into 5-second chunks and counts passes between players. No team classification.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={session?.id ?? ''}
            onChange={(e) => {
              setPassesSessionId(e.target.value);
              setStartError(null);
              setChunkIdx(0);
              setPlayFull(false);
            }}
            disabled={isStarting}
            className="px-3 py-2 rounded-xl border border-[#E8E3D8] bg-white text-xs font-semibold text-[#242424] max-w-[260px]"
          >
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.matchName}
              </option>
            ))}
          </select>
          <button
            onClick={() => void startDetection()}
            disabled={processing || !session}
            className="px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white shadow-2xs cursor-pointer disabled:opacity-60 disabled:cursor-wait"
          >
            {processing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
            <span>{processing ? 'Detecting…' : currentJob ? 'Re-run Detection' : 'Detect Passes'}</span>
          </button>
        </div>
      </div>

      {/* Status */}
      {startError && (
        <div className="p-4 rounded-2xl bg-[#FEF2F2] border border-[#FECACA] flex items-start gap-2 text-xs text-[#991B1B]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="font-bold block">Pass detection problem</span>
            <span className="break-words">{startError}</span>
          </div>
          <button
            onClick={() => void startDetection()}
            className="px-2.5 py-1 rounded-lg bg-white border border-[#FECACA] font-semibold hover:bg-[#FEE2E2] cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {currentJob?.status === 'failed' && (
        <div className="p-4 rounded-2xl bg-[#FEF2F2] border border-[#FECACA] flex items-start gap-2 text-xs text-[#991B1B]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="font-bold block">Processing failed</span>
            <span className="break-words">{currentJob.error || 'Unknown error.'}</span>
            {chunks.length > 0 && (
              <span className="block mt-1">
                {currentJob.total_passes ?? 0} passes were found in the {chunks.length} chunks finished before the error.
              </span>
            )}
          </div>
          <button
            onClick={() => void startDetection()}
            className="px-2.5 py-1 rounded-lg bg-white border border-[#FECACA] font-semibold hover:bg-[#FEE2E2] cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {!currentJob && !isStarting && !startError && (
        <div className="p-8 rounded-3xl bg-[#FAF8F4] border border-[#E8E3D8] text-center space-y-2">
          <Share2 className="w-10 h-10 text-[#2563EB] mx-auto" />
          <h4 className="text-base font-bold text-[#242424]">Detect passes for “{session?.matchName}”</h4>
          <p className="text-xs text-[#858585] max-w-md mx-auto">
            The video is processed in 5-second chunks. Each pass is drawn on the video and on the 2D pitch at the moment it happens.
          </p>
        </div>
      )}

      {(isStarting || currentJob) && currentJob?.status !== 'failed' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 p-4 rounded-2xl bg-[#FAF8F4] border border-[#E8E3D8] space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-[#242424]">
              <span className="flex items-center gap-1.5">
                {currentJob?.status === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#2563EB]" />
                )}
                {currentJob?.status === 'completed'
                  ? `All ${currentJob.total_chunks} chunks analysed`
                  : currentJob
                    ? `Analysing chunk ${Math.min(currentJob.completed_chunks + 1, currentJob.total_chunks)} of ${currentJob.total_chunks}`
                    : 'Starting…'}
              </span>
              <span className="font-mono text-[#555555]">{currentJob?.progress_percent ?? 0}%</span>
            </div>
            <div className="h-2 rounded-full bg-[#EEEBE3] overflow-hidden">
              <div
                className="h-full bg-[#2563EB] transition-all duration-500"
                style={{ width: `${currentJob?.progress_percent ?? 0}%` }}
              />
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-between">
            <div className="text-xs text-[#1E3A8A] font-semibold">
              {currentJob?.status === 'completed' ? 'Total passes' : 'Passes so far'}
            </div>
            <div className="text-3xl font-black text-[#1D4ED8] leading-none">{currentJob?.total_passes ?? 0}</div>
          </div>
        </div>
      )}

      {currentJob && chunks.length === 0 && currentJob.status === 'processing' && (
        <div className="p-6 rounded-2xl bg-[#171717] text-center text-xs text-[#D4D4D4] flex flex-col items-center gap-2">
          <Film className="w-8 h-8 text-[#2563EB] animate-pulse" />
          The first 5-second chunk is being analysed. Playback starts as soon as it is ready.
        </div>
      )}

      {currentJob && chunks.length > 0 && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {/* Video */}
            <div className="space-y-2">
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border border-[#262626]">
                <video
                  ref={videoRef}
                  key={videoSrc}
                  src={videoSrc ?? undefined}
                  controls
                  autoPlay
                  muted
                  playsInline
                  onLoadedMetadata={onLoaded}
                  onEnded={onEnded}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#858585]">
                <span>
                  {playFull ? 'Full video' : `Chunk ${chunkIdx + 1} of ${chunks.length}`} · {playTime.toFixed(1)}s
                </span>
                {currentJob.status === 'completed' && currentJob.full_video_url && (
                  <button
                    onClick={() => setPlayFull(!playFull)}
                    className="px-2.5 py-1 rounded-lg border border-[#E8E3D8] bg-white font-semibold text-[#242424] flex items-center gap-1 cursor-pointer"
                  >
                    <Video className="w-3.5 h-3.5" /> {playFull ? 'Play chunks' : 'Play full video'}
                  </button>
                )}
              </div>
            </div>

            {/* 2D view */}
            <div className="space-y-2">
              <PassPitch2D passes={passes} time={playTime} showHistory={showHistory} />
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#858585]">
                <span>
                  {passesSoFar} of {passes.length} passes by {playTime.toFixed(1)}s ·{' '}
                  {calibrated ? 'pitch coordinates (calibrated)' : 'camera view projected on a 2D pitch (not calibrated)'}
                </span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
                  Show earlier passes
                </label>
              </div>
            </div>
          </div>

          {/* Per-chunk breakdown */}
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424]">
              5-second chunks ({chunks.length}/{currentJob.total_chunks})
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {chunks.map((c, idx) => {
                const isCurrent = !playFull && idx === chunkIdx;
                return (
                  <button
                    key={c.chunk_index}
                    onClick={() => {
                      setPlayFull(false);
                      setChunkIdx(idx);
                    }}
                    className={`p-2.5 rounded-xl text-left border cursor-pointer transition-all ${
                      isCurrent ? 'bg-[#2563EB] text-white border-[#1D4ED8]' : 'bg-white border-[#E8E3D8] hover:bg-[#F5F2EB]'
                    }`}
                  >
                    <div className="text-xs font-bold">Chunk {idx + 1}</div>
                    <div className={`text-[10px] font-mono ${isCurrent ? 'text-white/80' : 'text-[#858585]'}`}>
                      {c.start_time.toFixed(1)}s – {c.end_time.toFixed(1)}s
                    </div>
                    <div className="text-sm font-black mt-1">{c.passes ?? 0} passes</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pass list */}
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#242424]">Detected passes ({passes.length})</h4>
            {passes.length === 0 ? (
              <p className="text-xs text-[#858585]">No passes detected yet.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-[#E8E3D8]">
                {passes.map((p) => {
                  const { from, to } = passPoints(p);
                  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
                  const active = playTime >= p.start_time && playTime <= p.end_time + HIGHLIGHT_SEC;
                  return (
                    <button
                      key={p.number}
                      onClick={() => seekTo(p.start_time - 1)}
                      className={`w-full flex items-center gap-3 py-2 px-2 text-xs text-left rounded-lg cursor-pointer ${
                        active ? 'bg-[#DBEAFE]' : 'hover:bg-[#F5F2EB]'
                      }`}
                      title="Jump to this pass"
                    >
                      <span className="font-black text-[#1D4ED8] w-10">#{p.number}</span>
                      <span className="font-mono w-28">
                        {p.start_time.toFixed(1)}s → {p.end_time.toFixed(1)}s
                      </span>
                      <span className="text-[#555555] flex-1">
                        Player {p.from_player} → Player {p.to_player}
                      </span>
                      {p.from_pitch && <span className="font-mono text-[#555555]">{dist.toFixed(1)} m</span>}
                      <span className="text-[#858585]">chunk {p.chunk}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/** Top-down 2D pitch. A pass in progress is a dashed line growing from passer to
 * receiver with the ball at its tip; a completed pass is a highlighted arrow that
 * fades into a thin trail. */
const PassPitch2D: React.FC<{ passes: NumberedPass[]; time: number; showHistory: boolean }> = ({
  passes,
  time,
  showHistory,
}) => {
  const line = '#FFFFFF';
  return (
    <div className="rounded-2xl overflow-hidden border border-[#14532D] bg-[#15803D]">
      <svg viewBox={`-3 -3 ${PITCH_L + 6} ${PITCH_W + 6}`} className="w-full h-auto block" role="img" aria-label="2D pass map">
        <defs>
          <marker id="pass-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#FACC15" />
          </marker>
          <marker id="pass-arrow-dim" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#FFFFFF" fillOpacity="0.5" />
          </marker>
        </defs>
        {/* stripes */}
        {Array.from({ length: 10 }).map((_, i) => (
          <rect key={i} x={i * (PITCH_L / 10)} y={0} width={PITCH_L / 10} height={PITCH_W} fill={i % 2 ? '#16A34A' : '#15803D'} />
        ))}
        {/* markings */}
        <g fill="none" stroke={line} strokeWidth={0.35} strokeOpacity={0.85}>
          <rect x={0} y={0} width={PITCH_L} height={PITCH_W} />
          <line x1={PITCH_L / 2} y1={0} x2={PITCH_L / 2} y2={PITCH_W} />
          <circle cx={PITCH_L / 2} cy={PITCH_W / 2} r={9.15} />
          <rect x={0} y={(PITCH_W - 40.3) / 2} width={16.5} height={40.3} />
          <rect x={PITCH_L - 16.5} y={(PITCH_W - 40.3) / 2} width={16.5} height={40.3} />
          <rect x={0} y={(PITCH_W - 18.3) / 2} width={5.5} height={18.3} />
          <rect x={PITCH_L - 5.5} y={(PITCH_W - 18.3) / 2} width={5.5} height={18.3} />
        </g>
        <circle cx={PITCH_L / 2} cy={PITCH_W / 2} r={0.5} fill={line} />

        {passes.map((p) => {
          const { from, to } = passPoints(p);
          if (time < p.start_time) return null;

          // In flight: grow the line towards the receiver.
          if (time <= p.end_time) {
            const span = Math.max(0.05, p.end_time - p.start_time);
            const f = Math.min(1, Math.max(0, (time - p.start_time) / span));
            const tip: [number, number] = [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f];
            return (
              <g key={p.number}>
                <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke="#FACC15" strokeOpacity={0.35} strokeWidth={0.4} strokeDasharray="1.2 1" />
                <line x1={from[0]} y1={from[1]} x2={tip[0]} y2={tip[1]} stroke="#FACC15" strokeWidth={0.7} strokeDasharray="1.5 0.8" />
                <circle cx={from[0]} cy={from[1]} r={1.3} fill="#1D4ED8" stroke="#fff" strokeWidth={0.3} />
                <circle cx={to[0]} cy={to[1]} r={1.3} fill="#1D4ED8" stroke="#fff" strokeWidth={0.3} fillOpacity={0.5} />
                <circle cx={tip[0]} cy={tip[1]} r={0.9} fill="#fff" stroke="#111" strokeWidth={0.2} />
              </g>
            );
          }

          const since = time - p.end_time;
          if (since <= HIGHLIGHT_SEC) {
            const opacity = since < HIGHLIGHT_SEC * 0.6 ? 1 : 1 - (since - HIGHLIGHT_SEC * 0.6) / (HIGHLIGHT_SEC * 0.4);
            const mx = (from[0] + to[0]) / 2;
            const my = (from[1] + to[1]) / 2;
            return (
              <g key={p.number} opacity={Math.max(0.15, opacity)}>
                <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke="#FACC15" strokeWidth={0.8} markerEnd="url(#pass-arrow)" />
                <circle cx={from[0]} cy={from[1]} r={1.3} fill="#1D4ED8" stroke="#fff" strokeWidth={0.3} />
                <circle cx={to[0]} cy={to[1]} r={1.3} fill="#1D4ED8" stroke="#fff" strokeWidth={0.3} />
                <rect x={mx - 6} y={my - 4.6} width={12} height={3.6} rx={0.8} fill="#111827" fillOpacity={0.85} />
                <text x={mx} y={my - 1.9} textAnchor="middle" fontSize={2.4} fontWeight={800} fill="#FACC15">
                  PASS #{p.number}
                </text>
              </g>
            );
          }

          if (!showHistory) return null;
          return (
            <line
              key={p.number}
              x1={from[0]}
              y1={from[1]}
              x2={to[0]}
              y2={to[1]}
              stroke="#FFFFFF"
              strokeOpacity={0.45}
              strokeWidth={0.35}
              markerEnd="url(#pass-arrow-dim)"
            />
          );
        })}
      </svg>
    </div>
  );
};
