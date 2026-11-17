'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Flame, Users } from 'lucide-react';
import type { HeatmapPhase, TacticalHeatmaps, TeamClusterInfo, TeamShape } from '@/types/football';

type Subject = 'team_1' | 'team_2' | 'both' | 'compare' | 'ball' | 'player';

interface TacticalHeatmapProps {
  data: TacticalHeatmaps;
  teams?: TeamClusterInfo[];
}

const FALLBACK: Record<number, string> = { 1: '#2563EB', 2: '#DC2626' };
const PHASES: { id: HeatmapPhase; label: string }[] = [
  { id: 'all', label: 'All phases' },
  { id: 'in_possession', label: 'In possession' },
  { id: 'out_of_possession', label: 'Out of possession' },
];

// Canvas resolution (px per metre) — independent of the display size.
const PX_PER_M = 10;

interface Layer {
  grid: number[][];
  /** Team colour for overlays; undefined = thermal colour ramp. */
  color?: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Thermal ramp: transparent blue -> cyan -> green -> yellow -> red. */
function thermal(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [30, 64, 175]],
    [0.25, [6, 182, 212]],
    [0.5, [34, 197, 94]],
    [0.75, [250, 204, 21]],
    [1, [220, 38, 38]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f)) as [number, number, number];
    }
  }
  return stops[stops.length - 1][1];
}

function sparseToGrid(cells: [number, number, number][], nx: number, ny: number): number[][] {
  const g = Array.from({ length: ny }, () => new Array<number>(nx).fill(0));
  cells.forEach(([x, y, c]) => {
    if (y < ny && x < nx) g[y][x] += c;
  });
  return g;
}

/** Share of presence per third (own -> attacking) and per channel (far, centre, near). */
function zoneShares(grid: number[][], attacking: 'left' | 'right' | null) {
  const ny = grid.length;
  const nx = ny ? grid[0].length : 0;
  const thirds = [0, 0, 0];
  const channels = [0, 0, 0];
  let total = 0;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const v = grid[y][x];
      if (!v) continue;
      total += v;
      let third = Math.min(2, Math.floor(((x + 0.5) / nx) * 3));
      if (attacking === 'left') third = 2 - third;
      thirds[third] += v;
      channels[Math.min(2, Math.floor(((y + 0.5) / ny) * 3))] += v;
    }
  }
  const pct = (a: number[]) => a.map((v) => (total ? Math.round((100 * v) / total) : 0));
  return { thirds: pct(thirds), channels: pct(channels), total };
}

/** One pitch: blurred heat layers on canvas + SVG markings and markers. */
const HeatPitch: React.FC<{
  data: TacticalHeatmaps;
  layers: Layer[];
  smoothing: number;
  markers?: { x: number; y: number; color: string; label: string }[];
  shapes?: { shape: TeamShape; color: string }[];
  caption?: React.ReactNode;
}> = ({ data, layers, smoothing, markers = [], shapes = [], caption }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stripesId = useId();
  const L = data.pitch.length;
  const W = data.pitch.width;
  const cw = Math.round(L * PX_PER_M);
  const ch = Math.round(W * PX_PER_M);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, cw, ch);
    layers.forEach((layer) => {
      const ny = layer.grid.length;
      const nx = ny ? layer.grid[0].length : 0;
      if (!nx) return;
      const max = Math.max(0, ...layer.grid.flat());
      if (max <= 0) return;
      const off = document.createElement('canvas');
      off.width = nx;
      off.height = ny;
      const octx = off.getContext('2d');
      if (!octx) return;
      const img = octx.createImageData(nx, ny);
      const rgb = layer.color ? hexToRgb(layer.color) : null;
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const v = layer.grid[y][x] / max;
          if (v <= 0) continue;
          const t = Math.pow(v, 0.55); // lift low-density areas
          const [r, g, b] = rgb ?? thermal(t);
          const i = (y * nx + x) * 4;
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          img.data[i + 3] = Math.round((rgb ? 40 + 200 * t : 60 + 190 * t) * Math.min(1, t * 3));
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.filter = smoothing > 0 ? `blur(${smoothing * data.cell_m * PX_PER_M}px)` : 'none';
      ctx.globalCompositeOperation = layers.length > 1 ? 'lighter' : 'source-over';
      // Grid covers nx*cell_m metres (may slightly exceed the pitch length).
      ctx.drawImage(off, 0, 0, nx * data.cell_m * PX_PER_M, ny * data.cell_m * PX_PER_M);
      ctx.restore();
    });
  }, [layers, smoothing, cw, ch, data.cell_m]);

  const cy = W / 2;
  const box = (x0: number, dir: number, depth: number, half: number) =>
    `M${x0},${cy - half} L${x0 + dir * depth},${cy - half} L${x0 + dir * depth},${cy + half} L${x0},${cy + half}`;
  const arc = (sx: number, dir: number) => {
    const half = Math.acos(5.5 / 9.15);
    const a0 = dir > 0 ? -half : Math.PI - half;
    const a1 = dir > 0 ? half : Math.PI + half;
    const p = (a: number) => `${sx + 9.15 * Math.cos(a)},${cy + 9.15 * Math.sin(a)}`;
    return `M${p(a0)} A9.15,9.15 0 0,1 ${p(a1)}`;
  };

  return (
    <div className="space-y-1.5">
      <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: `${L + 4} / ${W + 4}` }}>
        <svg viewBox={`-2 -2 ${L + 4} ${W + 4}`} className="absolute inset-0 w-full h-full">
          <defs>
            <pattern id={stripesId} width={L / 10} height={W} patternUnits="userSpaceOnUse">
              <rect width={L / 20} height={W} fill="#2E6B2A" />
              <rect x={L / 20} width={L / 20} height={W} fill="#2A6326" />
            </pattern>
          </defs>
          <rect x={-2} y={-2} width={L + 4} height={W + 4} fill="#25591F" />
          <rect x={0} y={0} width={L} height={W} fill={`url(#${stripesId})`} />
        </svg>
        <canvas
          ref={canvasRef}
          width={cw}
          height={ch}
          className="absolute"
          style={{
            left: `${(2 / (L + 4)) * 100}%`,
            top: `${(2 / (W + 4)) * 100}%`,
            width: `${(L / (L + 4)) * 100}%`,
            height: `${(W / (W + 4)) * 100}%`,
          }}
        />
        <svg viewBox={`-2 -2 ${L + 4} ${W + 4}`} className="absolute inset-0 w-full h-full pointer-events-none">
          <g fill="none" stroke="#F1F5F9" strokeWidth={0.3} opacity={0.85}>
            <rect x={0} y={0} width={L} height={W} />
            <line x1={L / 2} y1={0} x2={L / 2} y2={W} />
            <circle cx={L / 2} cy={cy} r={9.15} />
            <path d={box(0, 1, 16.5, 20.16)} />
            <path d={box(L, -1, 16.5, 20.16)} />
            <path d={box(0, 1, 5.5, 9.16)} />
            <path d={box(L, -1, 5.5, 9.16)} />
            <path d={arc(11, 1)} />
            <path d={arc(L - 11, -1)} />
            <rect x={-1.2} y={cy - 3.66} width={1.2} height={7.32} />
            <rect x={L} y={cy - 3.66} width={1.2} height={7.32} />
            {/* thirds */}
            <line x1={L / 3} y1={0} x2={L / 3} y2={W} strokeDasharray="1 1.2" opacity={0.5} />
            <line x1={(2 * L) / 3} y1={0} x2={(2 * L) / 3} y2={W} strokeDasharray="1 1.2" opacity={0.5} />
          </g>
          <circle cx={L / 2} cy={cy} r={0.4} fill="#F1F5F9" />

          {/* Team shape: average outfield block (width x depth around centroid) */}
          {shapes.map(({ shape, color }, i) => (
            <g key={i}>
              <rect
                x={shape.avg_centroid[0] - shape.avg_depth_m / 2}
                y={shape.avg_centroid[1] - shape.avg_width_m / 2}
                width={shape.avg_depth_m}
                height={shape.avg_width_m}
                fill="none"
                stroke={color}
                strokeWidth={0.45}
                strokeDasharray="1.5 1"
              />
              {shape.defensive_line_height_m != null && shape.defending_side && (
                <line
                  x1={
                    shape.defending_side === 'left'
                      ? shape.defensive_line_height_m
                      : L - shape.defensive_line_height_m
                  }
                  x2={
                    shape.defending_side === 'left'
                      ? shape.defensive_line_height_m
                      : L - shape.defensive_line_height_m
                  }
                  y1={1}
                  y2={W - 1}
                  stroke={color}
                  strokeWidth={0.6}
                />
              )}
            </g>
          ))}

          {markers.map((m, i) => (
            <g key={i}>
              <circle cx={m.x} cy={m.y} r={1.25} fill={m.color} stroke="#fff" strokeWidth={0.3} />
              <text
                x={m.x}
                y={m.y + 0.55}
                textAnchor="middle"
                fontSize={1.3}
                fontWeight={700}
                fill="#fff"
              >
                {m.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      {caption}
    </div>
  );
};

const ZoneBar: React.FC<{ color: string; names: string[]; values: number[] }> = ({ color, names, values }) => (
  <div className="flex h-5 rounded-md overflow-hidden text-[9px] font-bold text-white">
    {values.map((v, i) => (
      <div
        key={names[i]}
        className="flex items-center justify-center whitespace-nowrap overflow-hidden"
        style={{ width: `${Math.max(v, 0)}%`, background: color, opacity: 0.45 + 0.25 * i }}
        title={`${names[i]}: ${v}%`}
      >
        {v >= 12 ? `${names[i]} ${v}%` : ''}
      </div>
    ))}
  </div>
);

const ZoneBars: React.FC<{ label: string; color: string; grid: number[][]; attacking: 'left' | 'right' | null }> = ({
  label,
  color,
  grid,
  attacking,
}) => {
  const z = zoneShares(grid, attacking);
  if (!z.total) return null;
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-bold" style={{ color }}>
        {label}
      </div>
      <ZoneBar
        color={color}
        names={attacking ? ['Def. third', 'Middle', 'Att. third'] : ['Left third', 'Middle', 'Right third']}
        values={z.thirds}
      />
      <ZoneBar color={color} names={['Far channel', 'Centre', 'Near channel']} values={z.channels} />
    </div>
  );
};

export const TacticalHeatmap: React.FC<TacticalHeatmapProps> = ({ data, teams }) => {
  const [subject, setSubject] = useState<Subject>('both');
  const [phase, setPhase] = useState<HeatmapPhase>('all');
  const [smoothing, setSmoothing] = useState<number>(1.2);
  const [showPositions, setShowPositions] = useState<boolean>(true);
  const [showShape, setShowShape] = useState<boolean>(true);
  const playerIds = useMemo(
    () =>
      Object.values(data.players)
        .sort((a, b) => b.samples - a.samples)
        .map((p) => p.track_id),
    [data.players]
  );
  const [playerId, setPlayerId] = useState<number | null>(null);
  const activePlayer = playerId ?? playerIds[0] ?? null;

  const color = (t: number) => teams?.find((x) => x.team_id === t)?.color_hex || FALLBACK[t] || '#858585';
  const teamName = (t: number) => {
    const n = teams?.find((x) => x.team_id === t)?.color_name;
    return `Team ${t}${n ? ` (${n})` : ''}`;
  };
  const shapeOf = (t: number) => (t === 1 ? data.shape.team_1 : data.shape.team_2);
  const gridOf = (t: number) => (t === 1 ? data.teams.team_1 : data.teams.team_2)[phase];

  const markersFor = (filter: (team: number | null) => boolean) =>
    showPositions
      ? Object.values(data.players)
          .filter((p) => filter(p.team) && p.samples >= 10)
          .sort((a, b) => b.samples - a.samples)
          .slice(0, 24)
          .map((p) => ({
            x: p.avg_position[0],
            y: p.avg_position[1],
            color: p.team ? color(p.team) : '#6B7280',
            label: String(p.track_id),
          }))
      : [];

  const shapesFor = (ids: number[]) =>
    showShape
      ? ids
          .map((t) => ({ shape: shapeOf(t), color: color(t) }))
          .filter((s): s is { shape: TeamShape; color: string } => !!s.shape)
      : [];

  const attackLabel = (t: number) => {
    const dir = shapeOf(t)?.attacking_direction;
    return dir ? `${teamName(t)} attacks ${dir === 'right' ? '→' : '←'}` : null;
  };

  const renderShapeStats = (t: number) => {
    const s = shapeOf(t);
    if (!s) return null;
    return (
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ['Width', `${s.avg_width_m} m`],
          ['Depth', `${s.avg_depth_m} m`],
          ['Def. line', s.defensive_line_height_m == null ? '—' : `${s.defensive_line_height_m} m`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-[#FAF8F4] border border-[#E8E3D8] py-1">
            <div className="text-[9px] uppercase tracking-wide text-[#858585]">{k}</div>
            <div className="text-xs font-mono font-bold" style={{ color: color(t) }}>
              {v}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const teamPanel = (t: number) => (
    <div className="space-y-2">
      <HeatPitch
        data={data}
        layers={[{ grid: gridOf(t) }]}
        smoothing={smoothing}
        markers={markersFor((team) => team === t)}
        shapes={shapesFor([t])}
        caption={
          <div className="flex items-center justify-between text-[10px] text-[#858585]">
            <span className="font-bold" style={{ color: color(t) }}>
              {teamName(t)}
            </span>
            <span>{attackLabel(t)}</span>
          </div>
        }
      />
      {renderShapeStats(t)}
      <ZoneBars label="Presence by zone" color={color(t)} grid={gridOf(t)} attacking={shapeOf(t)?.attacking_direction ?? null} />
    </div>
  );

  let body: React.ReactNode;
  if (subject === 'compare') {
    body = (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {teamPanel(1)}
        {teamPanel(2)}
      </div>
    );
  } else if (subject === 'team_1' || subject === 'team_2') {
    body = teamPanel(subject === 'team_1' ? 1 : 2);
  } else if (subject === 'both') {
    body = (
      <div className="space-y-2">
        <HeatPitch
          data={data}
          layers={[
            { grid: gridOf(1), color: color(1) },
            { grid: gridOf(2), color: color(2) },
          ]}
          smoothing={smoothing}
          markers={markersFor((team) => team === 1 || team === 2)}
          shapes={shapesFor([1, 2])}
          caption={
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#858585]">
              <span className="flex items-center gap-3">
                {[1, 2].map((t) => (
                  <span key={t} className="flex items-center gap-1 font-bold" style={{ color: color(t) }}>
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color(t) }} />
                    {teamName(t)}
                  </span>
                ))}
              </span>
              <span>{[attackLabel(1), attackLabel(2)].filter(Boolean).join(' · ')}</span>
            </div>
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2].map((t) => (
            <div key={t} className="space-y-2">
              {renderShapeStats(t)}
              <ZoneBars
                label={teamName(t)}
                color={color(t)}
                grid={gridOf(t)}
                attacking={shapeOf(t)?.attacking_direction ?? null}
              />
            </div>
          ))}
        </div>
      </div>
    );
  } else if (subject === 'ball') {
    body = (
      <HeatPitch
        data={data}
        layers={[{ grid: data.ball }]}
        smoothing={smoothing}
        caption={<div className="text-[10px] text-[#858585]">Where the ball was on the pitch (detected samples only).</div>}
      />
    );
  } else {
    const p = activePlayer != null ? data.players[String(activePlayer)] : undefined;
    body = p ? (
      <HeatPitch
        data={data}
        layers={[{ grid: sparseToGrid(p.cells, data.nx, data.ny) }]}
        smoothing={smoothing}
        markers={[
          {
            x: p.avg_position[0],
            y: p.avg_position[1],
            color: p.team ? color(p.team) : '#6B7280',
            label: String(p.track_id),
          },
        ]}
        caption={
          <div className="text-[10px] text-[#858585]">
            Track #{p.track_id} · {p.team ? teamName(p.team) : 'unassigned'} · {p.samples} samples
          </div>
        }
      />
    ) : (
      <div className="text-xs text-[#858585] py-8 text-center">Not enough tracked samples per player yet.</div>
    );
  }

  const phaseDisabled = subject === 'ball' || subject === 'player';

  return (
    <div className="p-4 rounded-2xl bg-white border border-[#E8E3D8] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-[#242424] flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-[#DC2626]" /> Tactical heatmap
        </span>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['both', 'Both teams'],
              ['compare', 'Side by side'],
              ['team_1', 'Team 1'],
              ['team_2', 'Team 2'],
              ['ball', 'Ball'],
              ['player', 'Player'],
            ] as [Subject, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSubject(id)}
              className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer ${
                subject === id ? 'bg-[#262626] text-white' : 'bg-[#EEEBE3] text-[#555555] hover:bg-[#E8E3D8]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[#555555]">
        <div className={`flex gap-1 ${phaseDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
          {PHASES.map((ph) => (
            <button
              key={ph.id}
              onClick={() => setPhase(ph.id)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border cursor-pointer ${
                phase === ph.id ? 'border-[#262626] text-[#242424] bg-[#FAF8F4]' : 'border-[#E8E3D8]'
              }`}
            >
              {ph.label}
            </button>
          ))}
        </div>
        {subject === 'player' && (
          <label className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            <select
              value={activePlayer ?? ''}
              onChange={(e) => setPlayerId(parseInt(e.target.value, 10))}
              className="px-2 py-0.5 rounded-md bg-[#FAF8F4] border border-[#E8E3D8] font-mono"
            >
              {playerIds.map((id) => {
                const p = data.players[String(id)];
                return (
                  <option key={id} value={id}>
                    #{id} {p.team ? `T${p.team}` : ''} ({p.samples})
                  </option>
                );
              })}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1.5">
          Smoothing
          <input
            type="range"
            min={0}
            max={3}
            step={0.2}
            value={smoothing}
            onChange={(e) => setSmoothing(parseFloat(e.target.value))}
            className="w-20 accent-[#262626]"
          />
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={showPositions} onChange={(e) => setShowPositions(e.target.checked)} />
          Avg positions
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={showShape} onChange={(e) => setShowShape(e.target.checked)} />
          Team shape &amp; line
        </label>
      </div>

      {body}

      <p className="text-[10px] text-[#858585]">
        {data.cell_m} m grid from pitch-calibrated positions. Phases use the team in possession at each sample;
        dashed box = average outfield block (width × depth), solid line = average defensive line. Numbers are
        tracker IDs.
      </p>
    </div>
  );
};
