'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Download, Goal, ArrowRightLeft, Activity, Footprints } from 'lucide-react';
import type {
  MatchAnalyticsEvent,
  MatchStats,
  TacticalHeatmaps,
  TeamClusterInfo,
} from '@/types/football';
import { fetchTacticalHeatmaps, type MatchLogUrls } from '@/lib/yoloApi';
import { TacticalHeatmap } from '@/components/common/TacticalHeatmap';

interface MatchStatsPanelProps {
  stats: MatchStats;
  logs?: MatchLogUrls | null;
  teams?: TeamClusterInfo[];
  onSeek?: (timestamp: number) => void;
}

const FALLBACK = { 1: '#2563EB', 2: '#DC2626' } as Record<number, string>;
const EVENT_STYLE: Record<string, { label: string; cls: string }> = {
  goal: { label: 'GOAL', cls: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]' },
  pass: { label: 'PASS', cls: 'bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]' },
  interception: { label: 'INTERCEPT', cls: 'bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]' },
  tackle: { label: 'TACKLE', cls: 'bg-[#FFF7ED] text-[#9A3412] border-[#FED7AA]' },
  out: { label: 'OUT', cls: 'bg-[#F5F5F4] text-[#44403C] border-[#E7E5E4]' },
};

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m.toString().padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

export const MatchStatsPanel: React.FC<MatchStatsPanelProps> = ({ stats, logs, teams, onSeek }) => {
  const [filter, setFilter] = useState<'all' | 'goal' | 'pass' | 'turnover' | 'out'>('all');
  const [heatmaps, setHeatmaps] = useState<TacticalHeatmaps | null>(null);

  // heatmaps.json is rewritten after every chunk; refetch when new samples arrive.
  const heatmapsUrl = logs?.heatmaps_json;
  useEffect(() => {
    if (!heatmapsUrl) return;
    let alive = true;
    fetchTacticalHeatmaps(heatmapsUrl).then((h) => {
      if (alive && h) setHeatmaps(h);
    });
    return () => {
      alive = false;
    };
  }, [heatmapsUrl, stats.samples]);
  const color = (t: number) =>
    teams?.find((x) => x.team_id === t)?.color_hex || FALLBACK[t] || '#858585';
  const name = (t: number | null | undefined) =>
    t === 1 || t === 2
      ? `Team ${t}${teams?.find((x) => x.team_id === t)?.color_name ? ` (${teams.find((x) => x.team_id === t)?.color_name})` : ''}`
      : '—';

  const events = useMemo(() => {
    const list = [...stats.events].reverse();
    if (filter === 'all') return list;
    if (filter === 'turnover') return list.filter((e) => e.type === 'interception' || e.type === 'tackle');
    return list.filter((e) => e.type === filter);
  }, [stats.events, filter]);

  const t1 = stats.teams.team_1;
  const t2 = stats.teams.team_2;
  const rows: { label: string; a: string | number; b: string | number }[] = [
    { label: 'Possession', a: `${t1.possession_percent}%`, b: `${t2.possession_percent}%` },
    { label: 'Passes completed', a: t1.passes_completed, b: t2.passes_completed },
    {
      label: 'Pass accuracy',
      a: t1.pass_accuracy == null ? '—' : `${t1.pass_accuracy}%`,
      b: t2.pass_accuracy == null ? '—' : `${t2.pass_accuracy}%`,
    },
    { label: 'Interceptions won', a: t1.interceptions, b: t2.interceptions },
    { label: 'Tackles won', a: t1.tackles, b: t2.tackles },
    { label: 'Turnovers', a: t1.turnovers, b: t2.turnovers },
    { label: 'Distance covered', a: `${t1.distance_km} km`, b: `${t2.distance_km} km` },
  ];

  const renderEvent = (e: MatchAnalyticsEvent) => {
    const style = EVENT_STYLE[e.type] ?? EVENT_STYLE.out;
    return (
      <button
        key={e.id}
        onClick={() => onSeek?.(e.timestamp)}
        className="w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-lg hover:bg-[#FBFAF7] cursor-pointer"
      >
        <span className="font-mono text-[10px] text-[#858585] w-14 shrink-0 pt-0.5">{fmt(e.timestamp)}</span>
        <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border shrink-0 ${style.cls}`}>
          {style.label}
        </span>
        {e.team != null && (
          <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: color(e.team) }} />
        )}
        <span className="text-[11px] text-[#242424]">{e.description}</span>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      {/* Scoreboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-1 p-4 rounded-2xl bg-[#262626] text-white flex flex-col items-center justify-center">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/60 flex items-center gap-1.5">
            <Goal className="w-3.5 h-3.5" /> Score
          </div>
          <div className="flex items-center gap-4 mt-2">
            <span className="w-3 h-3 rounded-full" style={{ background: color(1) }} />
            <span className="text-4xl font-black font-mono">
              {stats.score.team_1} – {stats.score.team_2}
            </span>
            <span className="w-3 h-3 rounded-full" style={{ background: color(2) }} />
          </div>
          <div className="text-[10px] text-white/60 mt-2 text-center">
            {stats.goals.length === 0
              ? 'No goals detected'
              : stats.goals.map((g) => `${fmt(g.timestamp)} ${name(g.team)}${g.own_goal ? ' (OG)' : ''}`).join(' · ')}
          </div>
        </div>

        <div className="md:col-span-2 p-4 rounded-2xl bg-white border border-[#E8E3D8]">
          <div className="flex items-center justify-between text-[11px] font-bold mb-2">
            <span style={{ color: color(1) }}>{name(1)}</span>
            <span className="text-[#858585] font-semibold flex items-center gap-1">
              <Activity className="w-3.5 h-3.5" /> {stats.duration_analyzed_sec.toFixed(0)} s analysed · ball seen{' '}
              {stats.ball.detected_percent}%
            </span>
            <span style={{ color: color(2) }}>{name(2)}</span>
          </div>
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs">
                <span className="font-mono font-bold text-right">{r.a}</span>
                <span className="text-[10px] text-[#858585] uppercase tracking-wide w-32 text-center">
                  {r.label}
                </span>
                <span className="font-mono font-bold">{r.b}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 h-2 rounded-full overflow-hidden flex bg-[#E8E3D8]">
            <div style={{ width: `${t1.possession_percent}%`, background: color(1) }} />
            <div style={{ width: `${t2.possession_percent}%`, background: color(2) }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Event log */}
        <div className="xl:col-span-2 p-4 rounded-2xl bg-white border border-[#E8E3D8]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-xs font-bold text-[#242424] flex items-center gap-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5" /> Match event log
            </span>
            <div className="flex gap-1">
              {(['all', 'goal', 'pass', 'turnover', 'out'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer ${
                    filter === f ? 'bg-[#262626] text-white' : 'bg-[#EEEBE3] text-[#555555]'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'turnover' ? 'Turnovers' : `${f[0].toUpperCase()}${f.slice(1)}s`}
                  {f === 'pass' && stats.event_counts.pass ? ` ${stats.event_counts.pass}` : ''}
                  {f === 'goal' && stats.event_counts.goal ? ` ${stats.event_counts.goal}` : ''}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-[#F0ECE4]">
            {events.length === 0 ? (
              <div className="text-xs text-[#858585] py-6 text-center">No events yet.</div>
            ) : (
              events.map(renderEvent)
            )}
          </div>
        </div>

        {/* Team shape + downloads */}
        <div className="space-y-3">
          {[1, 2].map((t) => {
            const shape = (t === 1 ? t1 : t2).shape;
            return (
              <div key={t} className="p-3 rounded-2xl bg-white border border-[#E8E3D8] space-y-1 text-[11px]">
                <div className="font-bold" style={{ color: color(t) }}>
                  {name(t)} shape
                </div>
                {shape ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
                    <span className="text-[#858585] font-sans">Width</span>
                    <span>{shape.avg_width_m} m</span>
                    <span className="text-[#858585] font-sans">Depth</span>
                    <span>{shape.avg_depth_m} m</span>
                    <span className="text-[#858585] font-sans">Defensive line</span>
                    <span>
                      {shape.defensive_line_height_m == null ? '—' : `${shape.defensive_line_height_m} m`}
                    </span>
                    <span className="text-[#858585] font-sans">Attacks</span>
                    <span>
                      {shape.attacking_direction == null
                        ? '—'
                        : shape.attacking_direction === 'right'
                        ? 'left → right'
                        : 'right → left'}
                    </span>
                  </div>
                ) : (
                  <div className="text-[#858585]">Needs 4+ players of this team on the pitch.</div>
                )}
              </div>
            );
          })}
          {logs && (
            <div className="p-3 rounded-2xl bg-white border border-[#E8E3D8] space-y-1.5 text-[11px]">
              <div className="font-bold text-[#242424] flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Logs
              </div>
              {[
                ['Players log (CSV)', logs.players_csv],
                ['Ball log (CSV)', logs.ball_csv],
                ['Events (JSON)', logs.events_json],
                ['Match stats (JSON)', logs.match_stats_json],
                ...(logs.heatmaps_json ? [['Heatmaps (JSON)', logs.heatmaps_json]] : []),
              ].map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="block text-[#2563EB] hover:underline"
                >
                  {label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tactical heatmap (both teams, per team, phases, ball, player) */}
      {heatmaps ? (
        <TacticalHeatmap data={heatmaps} teams={teams} />
      ) : (
        <div className="p-4 rounded-2xl bg-white border border-[#E8E3D8] text-xs text-[#858585]">
          Tactical heatmap will appear after the first analysed chunk.
        </div>
      )}

      {/* Player table */}
      <div className="p-4 rounded-2xl bg-white border border-[#E8E3D8]">
        <div className="text-xs font-bold text-[#242424] flex items-center gap-1.5 mb-2">
          <Footprints className="w-3.5 h-3.5" /> Player tracking ({stats.players.length} tracks)
        </div>
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-[11px]">
            <thead className="text-[#858585] text-left sticky top-0 bg-white">
              <tr>
                {['Track', 'Team', 'Distance', 'Top speed', 'Avg pos (m)', 'Touches', 'Passes', 'Received', 'Lost', 'On ball', 'Goals'].map(
                  (h) => (
                    <th key={h} className="py-1.5 pr-3 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="font-mono">
              {stats.players.slice(0, 60).map((p) => (
                <tr key={p.track_id} className="border-t border-[#F0ECE4]">
                  <td className="py-1 pr-3">#{p.track_id}</td>
                  <td className="py-1 pr-3">
                    {p.team ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ background: color(p.team) }} />T{p.team}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-1 pr-3">{p.distance_m} m</td>
                  <td className="py-1 pr-3">{p.max_speed_kmh} km/h</td>
                  <td className="py-1 pr-3">
                    {p.avg_x_m}, {p.avg_y_m}
                  </td>
                  <td className="py-1 pr-3">{p.touches}</td>
                  <td className="py-1 pr-3">{p.passes_completed}</td>
                  <td className="py-1 pr-3">{p.passes_received}</td>
                  <td className="py-1 pr-3">{p.turnovers}</td>
                  <td className="py-1 pr-3">{p.possession_sec}s</td>
                  <td className="py-1 pr-3">{p.goals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-[#858585] mt-2">
          Track IDs come from the tracker and can change when a player is occluded; full per-sample positions are in
          the players CSV log.
        </p>
      </div>
    </div>
  );
};
