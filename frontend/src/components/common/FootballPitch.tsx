'use client';

import React, { useState } from 'react';
import { PassNetworkNode, PassNetworkLink } from '@/types/football';

interface HeatPoint {
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  intensity: number; // 0 to 1
}

interface MovementStep {
  x: number;
  y: number;
  label?: string;
  speed?: number;
  type?: 'jog' | 'sprint' | 'walk' | 'touch';
}

interface PassTrajectoryData {
  from: { x: number; y: number; label: string };
  to: { x: number; y: number; label: string };
  distanceMeters: number;
  curveType?: 'straight' | 'through' | 'cross';
  success?: boolean;
}

interface FootballPitchProps {
  mode: 'heatmap' | 'positions' | 'movement' | 'passing' | 'trajectory' | 'blank';
  heatPoints?: HeatPoint[];
  movementSteps?: MovementStep[];
  networkNodes?: PassNetworkNode[];
  networkLinks?: PassNetworkLink[];
  trajectory?: PassTrajectoryData;
  heightClass?: string;
  showLegend?: boolean;
  interactive?: boolean;
  onNodeClick?: (nodeId: string) => void;
}

export const FootballPitch: React.FC<FootballPitchProps> = ({
  mode,
  heatPoints = [],
  movementSteps = [],
  networkNodes = [],
  networkLinks = [],
  trajectory,
  heightClass = 'h-[360px]',
  showLegend = true,
  interactive = true,
  onNodeClick,
}) => {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // SVG coordinate system: 1000 x 680 (FIFA standard pitch proportion 105m x 68m)
  const W = 1000;
  const H = 680;
  const margin = 30;
  const pitchLeft = margin;
  const pitchRight = W - margin;
  const pitchTop = margin;
  const pitchBottom = H - margin;
  const pitchW = pitchRight - pitchLeft;
  const pitchH = pitchBottom - pitchTop;
  const midX = pitchLeft + pitchW / 2;
  const midY = pitchTop + pitchH / 2;

  // Converts percentage coordinates (0-100) to pitch SVG coordinates
  const toSvgX = (percentX: number) => pitchLeft + (percentX / 100) * pitchW;
  const toSvgY = (percentY: number) => pitchTop + (percentY / 100) * pitchH;

  return (
    <div className={`relative w-full ${heightClass} flex flex-col justify-center items-center select-none overflow-hidden rounded-2xl bg-[#031324] border border-[#1B3554]/80 shadow-2xl shadow-black/40`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full object-contain"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Pitch background gradient */}
          <linearGradient id="pitchGrass" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#051726" />
            <stop offset="50%" stopColor="#071E31" />
            <stop offset="100%" stopColor="#041423" />
          </linearGradient>

          {/* Radial gradients for heat points */}
          {heatPoints.map((pt, idx) => (
            <radialGradient
              key={`heat-grad-${idx}`}
              id={`heat-grad-${idx}`}
              cx="50%"
              cy="50%"
              r="50%"
            >
              <stop offset="0%" stopColor="#EF4444" stopOpacity={pt.intensity * 0.9} />
              <stop offset="35%" stopColor="#F59E0B" stopOpacity={pt.intensity * 0.75} />
              <stop offset="70%" stopColor="#22C55E" stopOpacity={pt.intensity * 0.45} />
              <stop offset="100%" stopColor="#22C55E" stopOpacity="0" />
            </radialGradient>
          ))}

          {/* Passing trajectory arrow marker */}
          <marker
            id="passArrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#3B82F6" />
          </marker>

          <marker
            id="passArrowSuccess"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#22C55E" />
          </marker>
        </defs>

        {/* Base Pitch Turf */}
        <rect
          x={pitchLeft}
          y={pitchTop}
          width={pitchW}
          height={pitchH}
          fill="url(#pitchGrass)"
          rx="6"
        />

        {/* Alternating Pitch Lawn Mowing Stripes */}
        {Array.from({ length: 10 }).map((_, i) => (
          <rect
            key={`stripe-${i}`}
            x={pitchLeft + (i * pitchW) / 10}
            y={pitchTop}
            width={pitchW / 10}
            height={pitchH}
            fill={i % 2 === 0 ? 'rgba(255, 255, 255, 0.015)' : 'transparent'}
          />
        ))}

        {/* Pitch Boundary Markings */}
        <g stroke="#1F3D60" strokeWidth="2" fill="none">
          {/* Outer Boundary */}
          <rect
            x={pitchLeft}
            y={pitchTop}
            width={pitchW}
            height={pitchH}
            stroke="#284E7A"
            strokeWidth="2.5"
          />

          {/* Halfway Line */}
          <line x1={midX} y1={pitchTop} x2={midX} y2={pitchBottom} stroke="#284E7A" strokeWidth="2" />

          {/* Centre Circle (9.15m equivalent) */}
          <circle cx={midX} cy={midY} r={80} stroke="#284E7A" strokeWidth="2" />
          <circle cx={midX} cy={midY} r={3.5} fill="#3B82F6" stroke="none" />

          {/* Left Penalty Area */}
          <rect x={pitchLeft} y={midY - 145} width={150} height={290} stroke="#284E7A" strokeWidth="2" />
          {/* Left 6-Yard Box */}
          <rect x={pitchLeft} y={midY - 70} width={50} height={140} stroke="#284E7A" strokeWidth="1.5" />
          {/* Left Penalty Spot */}
          <circle cx={pitchLeft + 100} cy={midY} r={3} fill="#3B82F6" stroke="none" />
          {/* Left Penalty Arc */}
          <path
            d={`M ${pitchLeft + 150} ${midY - 55} A 80 80 0 0 1 ${pitchLeft + 150} ${midY + 55}`}
            stroke="#284E7A"
            strokeWidth="1.5"
          />

          {/* Right Penalty Area */}
          <rect x={pitchRight - 150} y={midY - 145} width={150} height={290} stroke="#284E7A" strokeWidth="2" />
          {/* Right 6-Yard Box */}
          <rect x={pitchRight - 50} y={midY - 70} width={50} height={140} stroke="#284E7A" strokeWidth="1.5" />
          {/* Right Penalty Spot */}
          <circle cx={pitchRight - 100} cy={midY} r={3} fill="#3B82F6" stroke="none" />
          {/* Right Penalty Arc */}
          <path
            d={`M ${pitchRight - 150} ${midY - 55} A 80 80 0 0 0 ${pitchRight - 150} ${midY + 55}`}
            stroke="#284E7A"
            strokeWidth="1.5"
          />

          {/* Left Goal Post */}
          <rect x={pitchLeft - 18} y={midY - 45} width={18} height={90} stroke="#EF4444" strokeWidth="2" strokeDasharray="3 3" />
          {/* Right Goal Post */}
          <rect x={pitchRight} y={midY - 45} width={18} height={90} stroke="#EF4444" strokeWidth="2" strokeDasharray="3 3" />

          {/* Corner Arcs */}
          <path d={`M ${pitchLeft} ${pitchTop + 16} A 16 16 0 0 0 ${pitchLeft + 16} ${pitchTop}`} />
          <path d={`M ${pitchLeft} ${pitchBottom - 16} A 16 16 0 0 1 ${pitchLeft + 16} ${pitchBottom}`} />
          <path d={`M ${pitchRight} ${pitchTop + 16} A 16 16 0 0 1 ${pitchRight - 16} ${pitchTop}`} />
          <path d={`M ${pitchRight} ${pitchBottom - 16} A 16 16 0 0 0 ${pitchRight - 16} ${pitchBottom}`} />
        </g>

        {/* 1. HEATMAP OVERLAY MODE */}
        {mode === 'heatmap' && (
          <g className="mix-blend-screen">
            {heatPoints.map((pt, idx) => {
              const cx = toSvgX(pt.x);
              const cy = toSvgY(pt.y);
              const radius = 60 + pt.intensity * 45;
              return (
                <circle
                  key={`heat-spot-${idx}`}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill={`url(#heat-grad-${idx})`}
                  opacity="0.85"
                />
              );
            })}
          </g>
        )}

        {/* 2. MOVEMENT PATH OVERLAY MODE */}
        {mode === 'movement' && movementSteps.length > 1 && (
          <g>
            {/* Smooth trajectory line */}
            {movementSteps.map((step, idx) => {
              if (idx === 0) return null;
              const prev = movementSteps[idx - 1];
              const x1 = toSvgX(prev.x);
              const y1 = toSvgY(prev.y);
              const x2 = toSvgX(step.x);
              const y2 = toSvgY(step.y);
              const isSprint = (step.speed || 0) > 22;

              return (
                <g key={`move-seg-${idx}`}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={isSprint ? '#F59E0B' : '#3B82F6'}
                    strokeWidth={isSprint ? '3.5' : '2'}
                    strokeDasharray={step.type === 'jog' ? '6 4' : undefined}
                    opacity="0.8"
                  />
                  {/* Waypoint circle */}
                  <circle
                    cx={x2}
                    cy={y2}
                    r={isSprint ? 6 : 4}
                    fill={isSprint ? '#F59E0B' : '#3B82F6'}
                    stroke="#020E1D"
                    strokeWidth="1.5"
                  />
                  {/* Speed/Label bubble */}
                  {step.speed && (
                    <g transform={`translate(${x2 + 8}, ${y2 - 8})`}>
                      <rect
                        x="-4"
                        y="-12"
                        width="68"
                        height="18"
                        rx="4"
                        fill="#0D203B"
                        stroke={isSprint ? '#F59E0B' : '#1B3554'}
                        strokeWidth="1"
                      />
                      <text
                        x="30"
                        y="0"
                        fill={isSprint ? '#FBBF24' : '#CBD5E1'}
                        fontSize="9.5"
                        fontWeight="600"
                        textAnchor="middle"
                      >
                        {step.speed} km/h
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* 3. PASSING NETWORK OVERLAY MODE */}
        {mode === 'passing' && (
          <g>
            {/* Connecting Links */}
            {networkLinks.map((link, idx) => {
              const source = networkNodes.find((n) => n.id === link.from);
              const target = networkNodes.find((n) => n.id === link.to);
              if (!source || !target) return null;

              const x1 = toSvgX(source.x);
              const y1 = toSvgY(source.y);
              const x2 = toSvgX(target.x);
              const y2 = toSvgY(target.y);
              const strokeWidth = Math.max(1.5, link.weight * 1.4);
              const isHeavy = link.weight >= 4;

              return (
                <line
                  key={`pass-link-${idx}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isHeavy ? '#22C55E' : '#3B82F6'}
                  strokeWidth={strokeWidth}
                  strokeOpacity={0.65}
                />
              );
            })}

            {/* Nodes */}
            {networkNodes.map((node) => {
              const cx = toSvgX(node.x);
              const cy = toSvgY(node.y);
              const r = 14 + (node.touches / 85) * 8;
              const isHovered = hoveredNode === node.id;

              return (
                <g
                  key={`node-${node.id}`}
                  className="cursor-pointer transition-transform"
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => onNodeClick && onNodeClick(node.id)}
                >
                  {/* Glow circle */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r + 4}
                    fill={isHovered ? '#0B5CFF' : 'transparent'}
                    opacity="0.3"
                  />
                  {/* Node fill */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="#0B5CFF"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                    className="shadow-md"
                  />
                  {/* Player Number */}
                  <text
                    x={cx}
                    y={cy + 4.5}
                    fill="#FFFFFF"
                    fontSize="11.5"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {node.num}
                  </text>
                  {/* Label under node */}
                  <text
                    x={cx}
                    y={cy + r + 13}
                    fill="#CBD5E1"
                    fontSize="9.5"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {node.name.split(' ')[1] || node.name}
                  </text>
                  <text
                    x={cx}
                    y={cy + r + 23}
                    fill="#64748B"
                    fontSize="8.5"
                    textAnchor="middle"
                  >
                    {node.touches} touches
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* 4. POSITIONS MODE (Tactical 11-player layout) */}
        {mode === 'positions' && (
          <g>
            {networkNodes.map((node) => {
              const cx = toSvgX(node.x);
              const cy = toSvgY(node.y);
              return (
                <g key={`pos-${node.id}`} className="cursor-pointer">
                  <circle cx={cx} cy={cy} r={18} fill="#0B5CFF" stroke="#38BDF8" strokeWidth="2" />
                  <text x={cx} y={cy + 4.5} fill="#FFFFFF" fontSize="12" fontWeight="bold" textAnchor="middle">
                    {node.num}
                  </text>
                  <rect
                    x={cx - 36}
                    y={cy + 22}
                    width="72"
                    height="18"
                    rx="4"
                    fill="#0D203B"
                    stroke="#1B3554"
                    strokeWidth="1"
                  />
                  <text x={cx} y={cy + 34} fill="#F8FAFC" fontSize="9" fontWeight="600" textAnchor="middle">
                    {node.name.split(' ')[1] || node.name} ({node.pos})
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* 5. TRAJECTORY MODE (Pass / Shot Vector) */}
        {mode === 'trajectory' && trajectory && (
          <g>
            {(() => {
              const x1 = toSvgX(trajectory.from.x);
              const y1 = toSvgY(trajectory.from.y);
              const x2 = toSvgX(trajectory.to.x);
              const y2 = toSvgY(trajectory.to.y);
              const dx = x2 - x1;
              const dy = y2 - y1;
              // Curved midpoint for natural football pass arc
              const cx = (x1 + x2) / 2 - dy * 0.15;
              const cy = (y1 + y2) / 2 + dx * 0.15;
              const pathD = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

              return (
                <g>
                  {/* Origin point */}
                  <circle cx={x1} cy={y1} r={8} fill="#0B5CFF" stroke="#FFFFFF" strokeWidth="2" />
                  <circle cx={x1} cy={y1} r={16} fill="#0B5CFF" opacity="0.25" />

                  {/* Trajectory curve */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={trajectory.success !== false ? '#22C55E' : '#EF4444'}
                    strokeWidth="3.5"
                    strokeDasharray="6 4"
                    markerEnd={trajectory.success !== false ? 'url(#passArrowSuccess)' : 'url(#passArrow)'}
                  />

                  {/* Destination point */}
                  <circle cx={x2} cy={y2} r={7} fill="#FBBF24" stroke="#FFFFFF" strokeWidth="2" />

                  {/* Trajectory badge */}
                  <g transform={`translate(${cx}, ${cy - 10})`}>
                    <rect x="-42" y="-12" width="84" height="20" rx="4" fill="#0D203B" stroke="#284E7A" strokeWidth="1" />
                    <text x="0" y="2" fill="#22C55E" fontSize="10" fontWeight="bold" textAnchor="middle">
                      {trajectory.distanceMeters.toFixed(1)} m
                    </text>
                  </g>

                  {/* Origin & Destination Labels */}
                  <text x={x1} y={y1 + 24} fill="#CBD5E1" fontSize="10" fontWeight="600" textAnchor="middle">
                    {trajectory.from.label}
                  </text>
                  <text x={x2} y={y2 + 24} fill="#FBBF24" fontSize="10" fontWeight="600" textAnchor="middle">
                    {trajectory.to.label}
                  </text>
                </g>
              );
            })()}
          </g>
        )}
      </svg>

      {/* HEATMAP LEGEND OVERLAY */}
      {mode === 'heatmap' && showLegend && (
        <div className="absolute bottom-3 left-4 bg-[#09162A]/90 backdrop-blur-md border border-[#1B3554] rounded-lg px-3 py-1.5 flex items-center gap-3 text-xs">
          <span className="text-[#94A3B8] font-medium">Activity Heatmap:</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[#64748B]">Low</span>
            <div className="w-20 h-2 rounded-full bg-gradient-to-r from-[#22C55E] via-[#FBBF24] to-[#EF4444]" />
            <span className="text-[10px] text-[#EF4444] font-medium">High</span>
          </div>
        </div>
      )}

      {/* PASS NETWORK LEGEND OVERLAY */}
      {mode === 'passing' && showLegend && (
        <div className="absolute bottom-3 left-4 bg-[#09162A]/90 backdrop-blur-md border border-[#1B3554] rounded-lg px-3 py-1.5 flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0B5CFF] border border-white" />
            <span className="text-[#94A3B8]">Player Position & Touches</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-[#22C55E]" />
            <span className="text-[#94A3B8]">High Pass Frequency (&gt;20)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-[#3B82F6]" />
            <span className="text-[#94A3B8]">Standard Connection</span>
          </div>
        </div>
      )}

      {/* MOVEMENT LEGEND OVERLAY */}
      {mode === 'movement' && showLegend && (
        <div className="absolute bottom-3 left-4 bg-[#09162A]/90 backdrop-blur-md border border-[#1B3554] rounded-lg px-3 py-1.5 flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#F59E0B]" />
            <span className="text-[#F59E0B] font-medium">Sprint (&gt;22 km/h)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#3B82F6] border-dashed" />
            <span className="text-[#94A3B8]">Jog / Recovery Run</span>
          </div>
        </div>
      )}
    </div>
  );
};
