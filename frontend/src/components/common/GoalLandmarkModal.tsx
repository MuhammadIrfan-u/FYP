'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Goal,
  MapPin,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { GoalLandmarksData, GoalPointId, MatchVideo } from '@/types/football';
import {
  deleteGoalLandmarks,
  getGoalLandmarks,
  saveGoalLandmarks,
  videoFrameUrl,
} from '@/lib/yoloApi';

/** Clicking order: both post feet (the goal line), then the two crossbar corners. */
const POINTS: { id: GoalPointId; short: string; label: string }[] = [
  { id: 'post_left_bottom', short: '1', label: 'Left post – bottom (on the goal line)' },
  { id: 'post_right_bottom', short: '2', label: 'Right post – bottom (on the goal line)' },
  { id: 'post_right_top', short: '3', label: 'Right post – top (crossbar corner)' },
  { id: 'post_left_top', short: '4', label: 'Left post – top (crossbar corner)' },
];
const GOAL_COLORS = ['#FACC15', '#38BDF8'];
const MAX_GOALS = 2;

type Side = 'left' | 'right' | null;
interface DraftGoal {
  id: string;
  label: string;
  side: Side;
  points: Partial<Record<GoalPointId, { x: number; y: number }>>; // frame pixels
}

const emptyGoal = (i: number): DraftGoal => ({
  id: `goal_${i + 1}`,
  label: `Goal ${i + 1}`,
  side: null,
  points: {},
});

const isComplete = (g: DraftGoal) => POINTS.every((p) => g.points[p.id]);

/** Small goal drawing showing which corner is which number. */
const GoalDiagram: React.FC<{ armed: GoalPointId | null; color: string }> = ({ armed, color }) => {
  const corners: Record<GoalPointId, [number, number]> = {
    post_left_bottom: [20, 70],
    post_right_bottom: [180, 70],
    post_right_top: [180, 14],
    post_left_top: [20, 14],
  };
  return (
    <svg viewBox="0 0 200 92" className="w-full h-auto" aria-label="Goal corner order">
      <rect x={0} y={0} width={200} height={92} rx={8} fill="#2F6B2A" />
      <path d="M20 70 L34 58 L166 58 L180 70" fill="none" stroke="#E8F5E9" strokeWidth={1} strokeDasharray="3 3" />
      <path d="M20 70 L20 14 L180 14 L180 70" fill="none" stroke="#FFFFFF" strokeWidth={3} />
      <line x1={0} y1={70} x2={200} y2={70} stroke="#E8F5E9" strokeWidth={1} />
      <line x1={20} y1={70} x2={180} y2={70} stroke={color} strokeWidth={2.5} />
      {POINTS.map((p) => {
        const [x, y] = corners[p.id];
        const hi = armed === p.id;
        return (
          <g key={p.id}>
            <circle cx={x} cy={y} r={hi ? 8 : 6.5} fill={hi ? color : '#111'} stroke="#fff" strokeWidth={1.2} />
            <text x={x} y={y + 3.2} textAnchor="middle" fontSize={9} fontWeight={700} fill={hi ? '#111' : '#fff'}>
              {p.short}
            </text>
          </g>
        );
      })}
      <text x={100} y={86} textAnchor="middle" fontSize={8} fill="#E8F5E9">
        goal line (1 → 2)
      </text>
    </svg>
  );
};

interface GoalLandmarkModalProps {
  video: MatchVideo;
  onClose: () => void;
  /** Called after the goals are saved on the backend. */
  onSaved: (data: GoalLandmarksData) => void;
  /** Shown as a secondary button when marking goals is optional in a flow. */
  onSkip?: () => void;
  continueLabel?: string;
}

export const GoalLandmarkModal: React.FC<GoalLandmarkModalProps> = ({
  video,
  onClose,
  onSaved,
  onSkip,
  continueLabel = 'Save goals',
}) => {
  const videoFilename = video.savedFilename || video.filename;

  const [goals, setGoals] = useState<DraftGoal[]>([emptyGoal(0)]);
  const [active, setActive] = useState<number>(0);
  const [armed, setArmed] = useState<GoalPointId | null>('post_left_bottom');
  const [frameTime, setFrameTime] = useState<number>(1);
  const [frameSrc, setFrameSrc] = useState<string>(() => videoFrameUrl(videoFilename, 1));
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [dragging, setDragging] = useState<{ goal: number; id: GoalPointId } | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hadSaved, setHadSaved] = useState<boolean>(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const savedLoaded = useRef(false);

  // Restore saved goals once the frame size is known (stored in percent).
  useEffect(() => {
    if (!natural || savedLoaded.current) return;
    savedLoaded.current = true;
    getGoalLandmarks(videoFilename).then((saved) => {
      if (!saved || !saved.goals.length) return;
      setHadSaved(true);
      setGoals(
        saved.goals.slice(0, MAX_GOALS).map((g, i) => ({
          id: g.id || `goal_${i + 1}`,
          label: g.label || `Goal ${i + 1}`,
          side: g.side,
          points: Object.fromEntries(
            POINTS.map((p) => {
              const [px, py] = g.points[p.id];
              return [p.id, { x: (px / 100) * natural.w, y: (py / 100) * natural.h }];
            })
          ) as DraftGoal['points'],
        }))
      );
      setArmed(null);
    });
  }, [natural, videoFilename]);

  const current = goals[active];
  const color = GOAL_COLORS[active % GOAL_COLORS.length];
  const completeGoals = goals.filter(isComplete);
  const partialGoals = goals.filter((g) => !isComplete(g) && Object.keys(g.points).length > 0);
  const canSave = completeGoals.length > 0 && partialGoals.length === 0 && !busy;

  const labelOf = useMemo(() => Object.fromEntries(POINTS.map((p) => [p.id, p.label])), []);

  /** Client coordinates -> source-frame pixels. */
  const toFramePx = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const img = imgRef.current;
      if (!img || !natural) return null;
      const rect = img.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * natural.w;
      const y = ((clientY - rect.top) / rect.height) * natural.h;
      if (x < 0 || y < 0 || x > natural.w || y > natural.h) return null;
      return { x, y };
    },
    [natural]
  );

  const setPoint = (goalIdx: number, id: GoalPointId, pos: { x: number; y: number }) => {
    setGoals((prev) =>
      prev.map((g, i) => (i === goalIdx ? { ...g, points: { ...g.points, [id]: pos } } : g))
    );
    setError(null);
  };

  const handleFrameClick = (e: React.MouseEvent) => {
    if (!armed || dragging) return;
    const pos = toFramePx(e.clientX, e.clientY);
    if (!pos) return;
    setPoint(active, armed, pos);
    const order = POINTS.map((p) => p.id);
    const next = order.slice(order.indexOf(armed) + 1).find((id) => !current.points[id]);
    setArmed(next ?? null);
  };

  const startDrag = (goal: number, id: GoalPointId) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setActive(goal);
    setDragging({ goal, id });
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const pos = toFramePx(e.clientX, e.clientY);
    if (pos) setPoint(dragging.goal, dragging.id, pos);
  };
  const endDrag = () => {
    if (dragging) setTimeout(() => setDragging(null), 0);
  };

  const resetGoal = () => {
    setGoals((prev) => prev.map((g, i) => (i === active ? { ...g, points: {} } : g)));
    setArmed('post_left_bottom');
  };

  const addGoal = () => {
    if (goals.length >= MAX_GOALS) return;
    setGoals((prev) => [...prev, emptyGoal(prev.length)]);
    setActive(goals.length);
    setArmed('post_left_bottom');
  };

  const removeGoal = (idx: number) => {
    setGoals((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [emptyGoal(0)];
    });
    setActive(0);
    setArmed(null);
  };

  const updateGoal = (patch: Partial<DraftGoal>) =>
    setGoals((prev) => prev.map((g, i) => (i === active ? { ...g, ...patch } : g)));

  const reloadFrame = () => {
    setNatural(null);
    setFrameError(null);
    setFrameSrc(videoFrameUrl(videoFilename, frameTime));
  };

  const handleSave = async () => {
    if (!natural || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const data = await saveGoalLandmarks({
        videoFilename,
        imageWidth: natural.w,
        imageHeight: natural.h,
        goals: completeGoals.map((g) => ({
          id: g.id,
          side: g.side,
          label: g.label,
          points: POINTS.map((p) => ({
            id: p.id,
            x: Math.round(g.points[p.id]!.x * 10) / 10,
            y: Math.round(g.points[p.id]!.y * 10) / 10,
          })),
        })),
      });
      onSaved(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving goals failed');
    } finally {
      setBusy(false);
    }
  };

  const handleClearSaved = async () => {
    await deleteGoalLandmarks(videoFilename);
    setHadSaved(false);
    setGoals([emptyGoal(0)]);
    setActive(0);
    setArmed('post_left_bottom');
  };

  const markerSize = Math.max(14, 18 / Math.sqrt(zoom));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-3xl w-full max-w-[1400px] max-h-[96vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[#E8E3D8]">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] text-[11px] font-semibold mb-1">
              <Goal className="w-3.5 h-3.5" />
              <span>Goal landmarks · used for goal detection</span>
            </div>
            <h3 className="text-lg sm:text-xl font-black text-[#242424] tracking-tight">Mark the goals</h3>
            <p className="text-xs text-[#858585] mt-0.5">
              Optional. Click the four corners of each goal mouth in order: both post feet on the goal line,
              then both ends of the crossbar, on a frame where the whole goal is visible. Marked goals are the
              most accurate for a fixed camera. If you skip this, or the camera pans or zooms, goals are
              detected automatically from the model&apos;s goal detections instead.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[#858585] hover:text-[#242424] hover:bg-[#EEEBE3] transition-colors cursor-pointer shrink-0"
            aria-label="Close goal marking"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_320px]">
          {/* Frame canvas */}
          <div className="min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r border-[#E8E3D8]">
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[#E8E3D8] text-xs">
              <label className="flex items-center gap-1.5 text-[#555555]">
                Frame at
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={frameTime}
                  onChange={(e) => setFrameTime(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-20 px-2 py-1 rounded-lg bg-white border border-[#E8E3D8] font-mono"
                />
                s
              </label>
              <button
                onClick={reloadFrame}
                className="px-2.5 py-1 rounded-lg bg-white border border-[#E8E3D8] hover:bg-[#EEEBE3] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Load frame
              </button>
              <div className="flex items-center gap-1 ml-auto">
                <button
                  onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
                  className="p-1.5 rounded-lg bg-white border border-[#E8E3D8] hover:bg-[#EEEBE3] cursor-pointer"
                  aria-label="Zoom out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom((z) => Math.min(5, +(z + 0.5).toFixed(1)))}
                  className="p-1.5 rounded-lg bg-white border border-[#E8E3D8] hover:bg-[#EEEBE3] cursor-pointer"
                  aria-label="Zoom in"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {armed && (
              <div className="px-4 py-1.5 bg-[#FEF9C3] text-[#854D0E] text-xs flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5" />
                {current.label}: click <strong>{labelOf[armed]}</strong>
                <button onClick={() => setArmed(null)} className="ml-auto underline cursor-pointer">
                  cancel
                </button>
              </div>
            )}

            <div className="flex-1 min-h-[240px] overflow-auto bg-[#1A1A1A]">
              <div
                className="relative select-none"
                style={{ width: `${zoom * 100}%` }}
                onClick={handleFrameClick}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={frameSrc}
                  alt="Video frame for marking the goals"
                  draggable={false}
                  onLoad={(e) =>
                    setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                  }
                  onError={() => setFrameError('Could not load a frame from the backend for this video.')}
                  className={`block w-full h-auto ${armed ? 'cursor-crosshair' : ''}`}
                />

                {/* Goal mouth outlines + goal lines */}
                {natural && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox={`0 0 ${natural.w} ${natural.h}`}
                    preserveAspectRatio="none"
                  >
                    {goals.map((g, gi) => {
                      const c = GOAL_COLORS[gi % GOAL_COLORS.length];
                      const pts = POINTS.map((p) => g.points[p.id]).filter(Boolean) as { x: number; y: number }[];
                      const a = g.points.post_left_bottom;
                      const b = g.points.post_right_bottom;
                      return (
                        <g key={g.id}>
                          {pts.length >= 2 && (
                            <polyline
                              points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                              fill={isComplete(g) ? `${c}22` : 'none'}
                              stroke="#FFFFFF"
                              strokeWidth={1.5}
                              vectorEffect="non-scaling-stroke"
                              strokeDasharray={isComplete(g) ? undefined : '4 3'}
                            />
                          )}
                          {isComplete(g) && pts.length === 4 && (
                            <line
                              x1={pts[3].x}
                              y1={pts[3].y}
                              x2={pts[0].x}
                              y2={pts[0].y}
                              stroke="#FFFFFF"
                              strokeWidth={1.5}
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                          {a && b && (
                            <line
                              x1={a.x}
                              y1={a.y}
                              x2={b.x}
                              y2={b.y}
                              stroke={c}
                              strokeWidth={3}
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                        </g>
                      );
                    })}
                  </svg>
                )}

                {/* Corner pins */}
                {natural &&
                  goals.map((g, gi) =>
                    POINTS.map((p) => {
                      const pos = g.points[p.id];
                      if (!pos) return null;
                      const c = GOAL_COLORS[gi % GOAL_COLORS.length];
                      return (
                        <div
                          key={`${g.id}-${p.id}`}
                          className="absolute"
                          style={{
                            left: `${(pos.x / natural.w) * 100}%`,
                            top: `${(pos.y / natural.h) * 100}%`,
                            transform: 'translate(-50%, -50%)',
                          }}
                        >
                          <div
                            onPointerDown={startDrag(gi, p.id)}
                            title={`${g.label}: ${p.label} — drag to adjust`}
                            className="rounded-full border-2 border-white cursor-move touch-none flex items-center justify-center text-[10px] font-black text-[#111]"
                            style={{ width: markerSize, height: markerSize, backgroundColor: c }}
                          >
                            {p.short}
                          </div>
                        </div>
                      );
                    })
                  )}

                {!natural && !frameError && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70 min-h-[240px]">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading frame…
                  </div>
                )}
              </div>
              {frameError && (
                <div className="p-4 text-xs text-[#FCA5A5]">
                  {frameError} Make sure the backend is running and still has this video in its uploads folder.
                </div>
              )}
            </div>
          </div>

          {/* Side panel */}
          <div className="min-h-0 overflow-y-auto p-4 space-y-4">
            <GoalDiagram armed={armed} color={color} />

            {/* Goal tabs */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {goals.map((g, gi) => (
                <button
                  key={g.id}
                  onClick={() => {
                    setActive(gi);
                    setArmed(isComplete(g) ? null : POINTS.find((p) => !g.points[p.id])?.id ?? null);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 cursor-pointer ${
                    gi === active
                      ? 'bg-[#262626] text-white border-[#262626]'
                      : 'bg-white text-[#404040] border-[#E8E3D8] hover:bg-[#EEEBE3]'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: GOAL_COLORS[gi % GOAL_COLORS.length] }}
                  />
                  {g.label}
                  {isComplete(g) && <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E]" />}
                </button>
              ))}
              {goals.length < MAX_GOALS && (
                <button
                  onClick={addGoal}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-dashed border-[#D4D4D4] text-[#555555] hover:bg-[#EEEBE3] cursor-pointer"
                >
                  + Second goal
                </button>
              )}
            </div>

            {/* Active goal settings */}
            <div className="space-y-2 text-xs">
              <label className="block space-y-1">
                <span className="font-semibold text-[#242424]">Which end of the pitch?</span>
                <select
                  value={current.side ?? ''}
                  onChange={(e) => updateGoal({ side: (e.target.value || null) as Side })}
                  className="w-full px-2 py-1.5 rounded-lg bg-white border border-[#E8E3D8]"
                >
                  <option value="">Not sure</option>
                  <option value="left">Left end</option>
                  <option value="right">Right end</option>
                </select>
                <span className="block text-[10px] text-[#858585]">
                  Optional. With a pitch calibration it lets the stats spot own goals.
                </span>
              </label>
            </div>

            {/* Corner checklist */}
            <div className="space-y-1.5">
              {POINTS.map((p) => {
                const placed = !!current.points[p.id];
                const isArmed = armed === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setArmed(p.id)}
                    className={`w-full px-2.5 py-2 rounded-xl border text-left text-xs flex items-center gap-2 cursor-pointer ${
                      isArmed
                        ? 'bg-[#FEF9C3] border-[#FDE68A]'
                        : 'bg-white border-[#E8E3D8] hover:bg-[#F5F2EB]'
                    }`}
                  >
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0"
                      style={{ backgroundColor: placed ? color : '#E8E3D8', color: '#111' }}
                    >
                      {p.short}
                    </span>
                    <span className="flex-1 text-[#242424]">{p.label}</span>
                    {placed && <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={resetGoal}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E8E3D8] hover:bg-[#EEEBE3] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Redo {current.label}
              </button>
              {goals.length > 1 && (
                <button
                  onClick={() => removeGoal(active)}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E8E3D8] hover:bg-[#FEE2E2] text-[#B91C1C] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              )}
            </div>

            <div className="p-3 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] text-[11px] text-[#1E3A8A] space-y-1">
              <p className="font-bold">Tips for accurate goals</p>
              <p>• Points 1 and 2 must sit exactly where the posts meet the grass — that line decides whether the ball is behind the goal line or in front of the goal.</p>
              <p>• Zoom in to place the corners precisely; drag a pin to fine-tune it.</p>
            </div>

            {error && (
              <div className="p-2.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3 border-t border-[#E8E3D8]">
          <span className="text-xs text-[#858585]">
            {completeGoals.length === 0
              ? 'Mark all four corners of at least one goal — or skip to detect goals automatically.'
              : partialGoals.length
              ? 'Finish or remove the goal that is only partly marked.'
              : `${completeGoals.length} goal${completeGoals.length === 1 ? '' : 's'} ready.`}
          </span>
          <div className="flex items-center gap-2">
            {hadSaved && (
              <button
                onClick={handleClearSaved}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2] cursor-pointer"
              >
                Clear saved goals
              </button>
            )}
            {onSkip && (
              <button
                onClick={onSkip}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-[#E8E3D8] hover:bg-[#EEEBE3] text-[#404040] cursor-pointer"
              >
                Skip — detect goals automatically
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center gap-1.5 cursor-pointer"
            >
              {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              {continueLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
