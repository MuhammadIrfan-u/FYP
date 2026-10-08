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
    <div className={`relative w-full ${heightClass} flex flex-col justify-center items-center select-none overflow-hidden rounded-2xl bg-[#FAF8F4] border border-[#E8E3D8] shadow-sm`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full object-contain"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Natural Football Pitch Grass Gradient */}
          <linearGradient id="naturalPitchGrass" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1E5E3A" />
            <stop offset="50%" stopColor="#236B42" />
            <stop offset="100%" stopColor="#195433" />
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
              <stop offset="0%" stopColor="#DC2626" stopOpacity={pt.intensity * 0.9} />
              <stop offset="35%" stopColor="#D97706" stopOpacity={pt.intensity * 0.75} />
              <stop offset="70%" stopColor="#16A34A" stopOpacity={pt.intensity * 0.45} />
              <stop offset="100%" stopColor="#16A34A" stopOpacity="0" />
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
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563EB" />
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
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#16A34A" />
          </marker>
        </defs>

        {/* Base Pitch Turf */}
        <rect
          x={pitchLeft}
          y={pitchTop}
          width={pitchW}
          height={pitchH}
          fill="url(#naturalPitchGrass)"
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
            fill={i % 2 === 0 ? 'rgba(255, 255, 255, 0.035)' : 'transparent'}
          />
        ))}

        {/* Pitch Boundary Markings in Crisp White */}
        <g stroke="#FFFFFF" strokeWidth="2.2" strokeOpacity="0.85" fill="none">
          {/* Outer Boundary */}
          <rect
            x={pitchLeft}
            y={pitchTop}
            width={pitchW}
            height={pitchH}
            strokeWidth="2.5"
          />

          {/* Halfway Line */}
          <line x1={midX} y1={pitchTop} x2={midX} y2={pitchBottom} strokeWidth="2" />

          {/* Centre Circle (9.15m equivalent) */}
          <circle cx={midX} cy={midY} r={80} strokeWidth="2" />
          <circle cx={midX} cy={midY} r={3.5} fill="#FFFFFF" stroke="none" />

          {/* Left Penalty Area */}
          <rect x={pitchLeft} y={midY - 145} width={150} height={290} strokeWidth="2" />
          {/* Left 6-Yard Box */}
          <rect x={pitchLeft} y={midY - 70} width={50} height={140} strokeWidth="1.5" />
          {/* Left Penalty Spot */}
          <circle cx={pitchLeft + 100} cy={midY} r={3} fill="#FFFFFF" stroke="none" />
          {/* Left Penalty Arc */}
          <path
            d={`M ${pitchLeft + 150} ${midY - 55} A 80 80 0 0 1 ${pitchLeft + 150} ${midY + 55}`}
            strokeWidth="1.5"
          />

          {/* Right Penalty Area */}
          <rect x={pitchRight - 150} y={midY - 145} width={150} height={290} strokeWidth="2" />
          {/* Right 6-Yard Box */}
          <rect x={pitchRight - 50} y={midY - 70} width={50} height={140} strokeWidth="1.5" />
          {/* Right Penalty Spot */}
          <circle cx={pitchRight - 100} cy={midY} r={3} fill="#FFFFFF" stroke="none" />
          {/* Right Penalty Arc */}
          <path
            d={`M ${pitchRight - 150} ${midY - 55} A 80 80 0 0 0 ${pitchRight - 150} ${midY + 55}`}
            strokeWidth="1.5"
          />

          {/* Left Goal Post */}
          <rect x={pitchLeft - 18} y={midY - 45} width={18} height={90} stroke="#FFFFFF" strokeWidth="2" strokeDasharray="3 3" />
          {/* Right Goal Post */}
          <rect x={pitchRight} y={midY - 45} width={18} height={90} stroke="#FFFFFF" strokeWidth="2" strokeDasharray="3 3" />

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
                    stroke={isSprint ? '#D97706' : '#2563EB'}
                    strokeWidth={isSprint ? '3.5' : '2'}
                    strokeDasharray={step.type === 'jog' ? '6 4' : undefined}
                    opacity="0.9"
                  />
                  {/* Waypoint circle */}
                  <circle
                    cx={x2}
                    cy={y2}
                    r={isSprint ? 6 : 4}
                    fill={isSprint ? '#D97706' : '#2563EB'}
                    stroke="#FFFFFF"
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
                        fill="#FAF8F4"
                        stroke={isSprint ? '#D97706' : '#E8E3D8'}
                        strokeWidth="1"
                      />
                      <text
                        x="30"
                        y="0"
                        fill={isSprint ? '#D97706' : '#242424'}
                        fontSize="9.5"
                        fontWeight="700"
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
                  stroke={isHeavy ? '#16A34A' : '#2563EB'}
                  strokeWidth={strokeWidth}
                  strokeOpacity={0.8}
                />
              );
            })}

            {/* Nodes in charcoal/brand */}
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
                    fill={isHovered ? '#262626' : 'transparent'}
                    opacity="0.25"
                  />
                  {/* Node fill */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="#262626"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                    className="shadow-sm"
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
                    fill="#FFFFFF"
                    fontSize="9.5"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {node.name.split(' ')[1] || node.name}
                  </text>
                  <text
                    x={cx}
                    y={cy + r + 23}
                    fill="#EFEBE1"
                    fontSize="8.5"
                    fontWeight="600"
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
                  <circle cx={cx} cy={cy} r={18} fill="#262626" stroke="#FFFFFF" strokeWidth="2" />
                  <text x={cx} y={cy + 4.5} fill="#FFFFFF" fontSize="12" fontWeight="bold" textAnchor="middle">
                    {node.num}
                  </text>
                  <rect
                    x={cx - 36}
                    y={cy + 22}
                    width="72"
                    height="18"
                    rx="4"
                    fill="#FAF8F4"
                    stroke="#E8E3D8"
                    strokeWidth="1"
                  />
                  <text x={cx} y={cy + 34} fill="#242424" fontSize="9" fontWeight="700" textAnchor="middle">
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
              const cx = (x1 + x2) / 2 - dy * 0.15;
              const cy = (y1 + y2) / 2 + dx * 0.15;
              const pathD = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

              return (
                <g>
                  {/* Origin point */}
                  <circle cx={x1} cy={y1} r={8} fill="#262626" stroke="#FFFFFF" strokeWidth="2" />
                  <circle cx={x1} cy={y1} r={16} fill="#262626" opacity="0.25" />

                  {/* Trajectory curve */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={trajectory.success !== false ? '#16A34A' : '#DC2626'}
                    strokeWidth="3.5"
                    strokeDasharray="6 4"
                    markerEnd={trajectory.success !== false ? 'url(#passArrowSuccess)' : 'url(#passArrow)'}
                  />

                  {/* Destination point */}
                  <circle cx={x2} cy={y2} r={7} fill="#D97706" stroke="#FFFFFF" strokeWidth="2" />

                  {/* Trajectory badge */}
                  <g transform={`translate(${cx}, ${cy - 10})`}>
                    <rect x="-42" y="-12" width="84" height="20" rx="4" fill="#FAF8F4" stroke="#E8E3D8" strokeWidth="1" />
                    <text x="0" y="2" fill="#16A34A" fontSize="10" fontWeight="bold" textAnchor="middle">
                      {trajectory.distanceMeters.toFixed(1)} m
                    </text>
                  </g>

                  {/* Origin & Destination Labels */}
                  <text x={x1} y={y1 + 24} fill="#FFFFFF" fontSize="10" fontWeight="700" textAnchor="middle">
                    {trajectory.from.label}
                  </text>
                  <text x={x2} y={y2 + 24} fill="#FDE68A" fontSize="10" fontWeight="700" textAnchor="middle">
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
        <div className="absolute bottom-3 left-4 bg-[#FAF8F4]/95 backdrop-blur-md border border-[#E8E3D8] rounded-xl px-3 py-1.5 flex items-center gap-3 text-xs shadow-sm">
          <span className="text-[#858585] font-semibold">Activity Heatmap:</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[#858585]">Low</span>
            <div className="w-20 h-2 rounded-full bg-gradient-to-r from-[#16A34A] via-[#D97706] to-[#DC2626]" />
            <span className="text-[10px] text-[#DC2626] font-bold">High</span>
          </div>
        </div>
      )}

      {/* PASS NETWORK LEGEND OVERLAY */}
      {mode === 'passing' && showLegend && (
        <div className="absolute bottom-3 left-4 bg-[#FAF8F4]/95 backdrop-blur-md border border-[#E8E3D8] rounded-xl px-3 py-1.5 flex items-center gap-4 text-xs shadow-sm">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#262626] border border-white" />
            <span className="text-[#858585] font-medium">Player Position & Touches</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-[#16A34A]" />
            <span className="text-[#858585] font-medium">High Volume (&gt;20)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-[#2563EB]" />
            <span className="text-[#858585] font-medium">Standard Connection</span>
          </div>
        </div>
      )}

      {/* MOVEMENT LEGEND OVERLAY */}
      {mode === 'movement' && showLegend && (
        <div className="absolute bottom-3 left-4 bg-[#FAF8F4]/95 backdrop-blur-md border border-[#E8E3D8] rounded-xl px-3 py-1.5 flex items-center gap-4 text-xs shadow-sm">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#D97706]" />
            <span className="text-[#D97706] font-bold">Sprint (&gt;22 km/h)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#2563EB] border-dashed" />
            <span className="text-[#858585] font-medium">Jog / Recovery Run</span>
          </div>
        </div>
      )}
    </div>
  );
};
