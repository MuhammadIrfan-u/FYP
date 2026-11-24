'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Crosshair,
  MapPin,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  CalibrationResult,
  MatchVideo,
  PitchLandmark,
  PlacedLandmark,
} from '@/types/football';
import {
  computeHomography,
  getPitchLandmarks,
  getSavedHomography,
  videoFrameUrl,
} from '@/lib/yoloApi';

interface PitchCalibrationModalProps {
  video: MatchVideo;
  onClose: () => void;
  /** Called after the calibration is computed and saved on the backend. */
  onCalibrated: (result: CalibrationResult) => void;
  continueLabel?: string;
}

const GROUP_LABELS: Record<string, string> = {
  corners: 'Corners',
  centre: 'Halfway & centre circle',
  left: 'Left goal end',
  right: 'Right goal end',
};

const DRAG_MIME = 'application/x-pitch-landmark';

/** Mini top-down pitch with the landmark positions (helps users find each point). */
const PitchDiagram: React.FC<{
  landmarks: PitchLandmark[];
  placed: Record<string, PlacedLandmark>;
  highlight: string | null;
  length: number;
  width: number;
}> = ({ landmarks, placed, highlight, length, width }) => {
  const W = 210;
  const H = (W * width) / length;
  const sx = W / length;
  const sy = H / width;
  const cy = width / 2;
  const box = (x0: number, dir: number, depth: number, half: number) =>
    `M${x0 * sx},${(cy - half) * sy} L${(x0 + dir * depth) * sx},${(cy - half) * sy} L${
      (x0 + dir * depth) * sx
    },${(cy + half) * sy} L${x0 * sx},${(cy + half) * sy}`;
  return (
    <svg viewBox={`-6 -6 ${W + 12} ${H + 12}`} className="w-full h-auto" aria-label="Pitch landmark map">
      <rect x={-6} y={-6} width={W + 12} height={H + 12} rx={6} fill="#2F6B2A" />
      <g fill="none" stroke="#E8F5E9" strokeWidth={1}>
        <rect x={0} y={0} width={W} height={H} />
        <line x1={W / 2} y1={0} x2={W / 2} y2={H} />
        <circle cx={W / 2} cy={H / 2} r={9.15 * sx} />
        <path d={box(0, 1, 16.5, 20.16)} />
        <path d={box(length, -1, 16.5, 20.16)} />
        <path d={box(0, 1, 5.5, 9.16)} />
        <path d={box(length, -1, 5.5, 9.16)} />
      </g>
      {landmarks.map((l) => {
        const isPlaced = !!placed[l.id];
        const isHi = highlight === l.id;
        return (
          <circle
            key={l.id}
            cx={l.x * sx}
            cy={l.y * sy}
            r={isHi ? 4.5 : 2.6}
            fill={isHi ? '#FACC15' : isPlaced ? '#22C55E' : '#FFFFFF'}
            stroke="#111"
            strokeWidth={0.8}
          />
        );
      })}
    </svg>
  );
};

export const PitchCalibrationModal: React.FC<PitchCalibrationModalProps> = ({
  video,
  onClose,
  onCalibrated,
  continueLabel = 'Save calibration & continue',
}) => {
  const videoFilename = video.savedFilename || video.filename;

  const [pitchLength, setPitchLength] = useState<number>(105);
  const [pitchWidth, setPitchWidth] = useState<number>(68);
  const [landmarks, setLandmarks] = useState<PitchLandmark[]>([]);
  const [minPoints, setMinPoints] = useState<number>(4);
  const [placed, setPlaced] = useState<Record<string, PlacedLandmark>>({});
  const [armed, setArmed] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [frameTime, setFrameTime] = useState<number>(1);
  const [frameSrc, setFrameSrc] = useState<string>(() => videoFrameUrl(videoFilename, 1));
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const savedLoaded = useRef(false);

  // Landmark catalogue (refreshes when the pitch size changes).
  useEffect(() => {
    let alive = true;
    getPitchLandmarks(pitchLength, pitchWidth)
      .then((res) => {
        if (!alive) return;
        setLandmarks(res.landmarks);
        setMinPoints(res.min_points);
      })
      .catch((e) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : 'Backend unreachable';
        setError(
          msg.includes('404')
            ? 'The backend does not have the calibration API (404) — restart it so it runs the latest code.'
            : `${msg}. Is the backend running?`
        );
      });
    return () => {
      alive = false;
    };
  }, [pitchLength, pitchWidth]);

  // Restore a saved calibration once the frame size is known.
  useEffect(() => {
    if (!natural || savedLoaded.current) return;
    savedLoaded.current = true;
    getSavedHomography(videoFilename).then((saved) => {
      if (!saved) return;
      const c = saved.calibration;
      const sx = natural.w / c.image_width;
      const sy = natural.h / c.image_height;
      const restored: Record<string, PlacedLandmark> = {};
      c.points.forEach((p) => {
        restored[p.id] = { id: p.id, x: p.image[0] * sx, y: p.image[1] * sy };
      });
      setPlaced(restored);
      setPitchLength(c.pitch_length);
      setPitchWidth(c.pitch_width);
      setResult(saved);
    });
  }, [natural, videoFilename]);

  const placedCount = Object.keys(placed).length;
  const grouped = useMemo(() => {
    const g: Record<string, PitchLandmark[]> = {};
    landmarks.forEach((l) => {
      (g[l.group] ||= []).push(l);
    });
    return g;
  }, [landmarks]);
  const labelOf = useMemo(
    () => Object.fromEntries(landmarks.map((l) => [l.id, l.label])),
    [landmarks]
  );

  const invalidate = () => setResult(null);

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

  const place = (id: string, pos: { x: number; y: number }) => {
    setPlaced((prev) => ({ ...prev, [id]: { id, x: pos.x, y: pos.y } }));
    invalidate();
  };

  const removePoint = (id: string) => {
    setPlaced((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    invalidate();
  };

  // HTML5 drag-and-drop from the palette onto the frame.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain');
    const pos = toFramePx(e.clientX, e.clientY);
    if (id && pos) {
      place(id, pos);
      setArmed(null);
    }
  };

  // Click-to-place (touch friendly): arm a landmark, then click the frame.
  const handleFrameClick = (e: React.MouseEvent) => {
    if (!armed || draggingId) return;
    const pos = toFramePx(e.clientX, e.clientY);
    if (pos) {
      place(armed, pos);
      // Auto-arm the next unplaced landmark in the same group.
      const group = landmarks.find((l) => l.id === armed)?.group;
      const next = landmarks.find(
        (l) => l.group === group && l.id !== armed && !placed[l.id]
      );
      setArmed(next ? next.id : null);
    }
  };

  // Fine-tune placed markers with pointer drag.
  const startMarkerDrag = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDraggingId(id);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingId) return;
    const pos = toFramePx(e.clientX, e.clientY);
    if (pos) place(draggingId, pos);
  };
  const endMarkerDrag = () => {
    if (draggingId) setTimeout(() => setDraggingId(null), 0);
  };

  const reloadFrame = () => {
    setNatural(null);
    setFrameError(null);
    setFrameSrc(videoFrameUrl(videoFilename, frameTime));
  };

  const handleCompute = async () => {
    if (!natural) return;
    setBusy(true);
    setError(null);
    try {
      const res = await computeHomography({
        videoFilename,
        imageWidth: natural.w,
        imageHeight: natural.h,
        pitchLength,
        pitchWidth,
        points: Object.values(placed).map((p) => ({
          id: p.id,
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
        })),
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Calibration failed');
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const markerSize = Math.max(14, 18 / Math.sqrt(zoom));
  const qualityTone =
    result?.quality.loo_rmse_m == null
      ? 'text-[#555555]'
      : result.quality.loo_rmse_m <= 1.5
      ? 'text-[#16A34A]'
      : result.quality.loo_rmse_m <= 3
      ? 'text-[#D97706]'
      : 'text-[#DC2626]';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-3xl w-full max-w-[1400px] max-h-[96vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[#E8E3D8]">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#ECFDF5] border border-[#A7F3D0] text-[#065F46] text-[11px] font-semibold mb-1">
              <Crosshair className="w-3.5 h-3.5" />
              <span>Step 1 of 2 · Pitch calibration (homography view)</span>
            </div>
            <h3 className="text-lg sm:text-xl font-black text-[#242424] tracking-tight">
              Place the field landmarks
            </h3>
            <p className="text-xs text-[#858585] mt-0.5">
              Drag landmarks from the list onto the matching pitch markings (or click a landmark, then
              click the frame). Use at least {minPoints}; 8+ spread over both halves and both touchlines
              corrects panorama curvature. Drag a pin to fine-tune it.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[#858585] hover:text-[#242424] hover:bg-[#EEEBE3] transition-colors cursor-pointer shrink-0"
            aria-label="Close calibration"
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
                Click on the frame to place <strong>{labelOf[armed]}</strong>
                <button onClick={() => setArmed(null)} className="ml-auto underline cursor-pointer">
                  cancel
                </button>
              </div>
            )}

            <div className="flex-1 min-h-[240px] overflow-auto bg-[#1A1A1A]">
              <div
                className="relative select-none"
                style={{ width: `${zoom * 100}%` }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={handleFrameClick}
                onPointerMove={handlePointerMove}
                onPointerUp={endMarkerDrag}
                onPointerCancel={endMarkerDrag}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={frameSrc}
                  alt="Video frame for pitch calibration"
                  draggable={false}
                  onLoad={(e) =>
                    setNatural({
                      w: e.currentTarget.naturalWidth,
                      h: e.currentTarget.naturalHeight,
                    })
                  }
                  onError={() => setFrameError('Could not load a frame from the backend for this video.')}
                  className={`block w-full h-auto ${armed ? 'cursor-crosshair' : ''}`}
                />

                {/* Projected pitch markings (after computing) */}
                {result && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    {result.overlay_lines.map((line, i) => (
                      <polyline
                        key={i}
                        points={line.map(([x, y]) => `${x},${y}`).join(' ')}
                        fill="none"
                        stroke="#FACC15"
                        strokeWidth={1.5}
                        vectorEffect="non-scaling-stroke"
                        opacity={0.9}
                      />
                    ))}
                  </svg>
                )}

                {/* Placed markers */}
                {natural &&
                  Object.values(placed).map((p) => {
                    const hi = hovered === p.id || draggingId === p.id;
                    return (
                      <div
                        key={p.id}
                        className="absolute"
                        style={{
                          left: `${(p.x / natural.w) * 100}%`,
                          top: `${(p.y / natural.h) * 100}%`,
                          transform: 'translate(-50%, -50%)',
                        }}
                      >
                        <div
                          onPointerDown={startMarkerDrag(p.id)}
                          onMouseEnter={() => setHovered(p.id)}
                          onMouseLeave={() => setHovered(null)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            removePoint(p.id);
                          }}
                          title={`${labelOf[p.id] ?? p.id} — drag to adjust, right-click to remove`}
                          className={`rounded-full border-2 cursor-move touch-none ${
                            hi ? 'border-[#FACC15] bg-[#FACC15]/40' : 'border-white bg-[#16A34A]/60'
                          }`}
                          style={{ width: markerSize, height: markerSize }}
                        >
                          <div className="w-1 h-1 rounded-full bg-white mx-auto mt-[calc(50%-2px)]" />
                        </div>
                        {hi && (
                          <div className="absolute left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px]">
                            {labelOf[p.id] ?? p.id}
                          </div>
                        )}
                      </div>
                    );
                  })}

                {!natural && !frameError && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70 min-h-[240px]">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading frame…
                  </div>
                )}
              </div>
              {frameError && (
                <div className="p-4 text-xs text-[#FCA5A5] space-y-1">
                  <div>{frameError}</div>
                  {!video.savedFilename ? (
                    <div>
                      This video is not on the analysis backend — it was probably uploaded while the backend was
                      offline. Start the backend, then upload the video again.
                    </div>
                  ) : (
                    <div>
                      Make sure the backend is running at the configured API URL and still has{' '}
                      <span className="font-mono">{video.savedFilename}</span> in its uploads folder.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Landmark palette */}
          <div className="min-h-0 overflow-y-auto p-4 space-y-4">
            <PitchDiagram
              landmarks={landmarks}
              placed={placed}
              highlight={hovered || armed}
              length={pitchLength}
              width={pitchWidth}
            />

            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="space-y-1">
                <span className="font-semibold text-[#242424]">Pitch length (m)</span>
                <input
                  type="number"
                  min={50}
                  max={130}
                  value={pitchLength}
                  onChange={(e) => {
                    setPitchLength(parseFloat(e.target.value) || 105);
                    invalidate();
                  }}
                  className="w-full px-2 py-1 rounded-lg bg-white border border-[#E8E3D8] font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-[#242424]">Pitch width (m)</span>
                <input
                  type="number"
                  min={30}
                  max={100}
                  value={pitchWidth}
                  onChange={(e) => {
                    setPitchWidth(parseFloat(e.target.value) || 68);
                    invalidate();
                  }}
                  className="w-full px-2 py-1 rounded-lg bg-white border border-[#E8E3D8] font-mono"
                />
              </label>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#242424]">
                Landmarks placed: <span className="font-mono">{placedCount}</span>
              </span>
              {placedCount > 0 && (
                <button
                  onClick={() => {
                    setPlaced({});
                    invalidate();
                  }}
                  className="flex items-center gap-1 text-[#858585] hover:text-[#DC2626] cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" /> Clear all
                </button>
              )}
            </div>

            {Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#858585]">
                  {GROUP_LABELS[group] ?? group}
                </div>
                <div className="space-y-1">
                  {items.map((l) => {
                    const isPlaced = !!placed[l.id];
                    const isArmed = armed === l.id;
                    return (
                      <div
                        key={l.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG_MIME, l.id);
                          e.dataTransfer.setData('text/plain', l.id);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onMouseEnter={() => setHovered(l.id)}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => setArmed(isArmed ? null : l.id)}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] cursor-grab active:cursor-grabbing transition-colors ${
                          isArmed
                            ? 'bg-[#FEF9C3] border-[#FACC15]'
                            : isPlaced
                            ? 'bg-[#F0FDF4] border-[#BBF7D0]'
                            : 'bg-white border-[#E8E3D8] hover:border-[#D9D3C5]'
                        }`}
                      >
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isPlaced ? 'bg-[#16A34A]' : 'bg-[#D9D3C5]'
                          }`}
                        />
                        <span className="flex-1 text-[#242424]">{l.label}</span>
                        {isPlaced && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removePoint(l.id);
                            }}
                            className="text-[#858585] hover:text-[#DC2626] cursor-pointer"
                            aria-label={`Remove ${l.label}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer: quality + actions */}
        <div className="px-5 py-3 border-t border-[#E8E3D8] flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1 min-w-0 text-xs space-y-1">
            {error && (
              <div className="flex items-start gap-1.5 text-[#991B1B]">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
              </div>
            )}
            {result && (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1 text-[#166534] font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Calibrated ({result.quality.model})
                  </span>
                  <span className="text-[#555555]">
                    Homography RMSE <span className="font-mono">{result.quality.homography_rmse_m} m</span>
                  </span>
                  {result.quality.loo_rmse_m != null && (
                    <span className={qualityTone}>
                      Consistency (leave-one-out){' '}
                      <span className="font-mono font-bold">{result.quality.loo_rmse_m} m</span>
                    </span>
                  )}
                  <span className="text-[#858585]">Yellow lines = projected pitch markings</span>
                </div>
                {result.warnings.map((w) => (
                  <div key={w} className="text-[#92400E]">
                    {w}
                  </div>
                ))}
              </>
            )}
            {!result && !error && (
              <span className="text-[#858585]">
                {placedCount < minPoints
                  ? `Place ${minPoints - placedCount} more landmark${minPoints - placedCount === 1 ? '' : 's'} to compute the homography.`
                  : 'Compute the homography and check that the yellow lines sit on the pitch markings.'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[#858585] hover:text-[#242424] hover:bg-[#EEEBE3] cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleCompute}
              disabled={busy || placedCount < minPoints || !natural}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-white border border-[#262626] text-[#262626] hover:bg-[#EEEBE3] disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
            >
              {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
              Compute homography
            </button>
            <button
              onClick={() => result && onCalibrated(result)}
              disabled={!result || busy}
              className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {continueLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
