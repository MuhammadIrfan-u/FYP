import React from 'react';
import { LucideIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  change?: string;
  isPositive?: boolean;
  supportingText: string;
  accentColor?: 'blue' | 'green' | 'yellow' | 'purple' | 'cyan';
}

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  icon: Icon,
  change,
  isPositive = true,
  supportingText,
  accentColor = 'blue',
}) => {
  const getAccentStyles = () => {
    switch (accentColor) {
      case 'green':
        return {
          iconBg: 'bg-[#22C55E]/10 border-[#22C55E]/30 text-[#22C55E]',
          glow: 'group-hover:border-[#22C55E]/40',
        };
      case 'yellow':
        return {
          iconBg: 'bg-[#FBBF24]/10 border-[#FBBF24]/30 text-[#FBBF24]',
          glow: 'group-hover:border-[#FBBF24]/40',
        };
      case 'purple':
        return {
          iconBg: 'bg-[#8B5CF6]/10 border-[#8B5CF6]/30 text-[#8B5CF6]',
          glow: 'group-hover:border-[#8B5CF6]/40',
        };
      case 'cyan':
        return {
          iconBg: 'bg-[#06B6D4]/10 border-[#06B6D4]/30 text-[#06B6D4]',
          glow: 'group-hover:border-[#06B6D4]/40',
        };
      case 'blue':
      default:
        return {
          iconBg: 'bg-[#0B5CFF]/15 border-[#0B5CFF]/30 text-[#3B82F6]',
          glow: 'group-hover:border-[#0B5CFF]/40',
        };
    }
  };

  const accent = getAccentStyles();

  return (
    <div
      className={`group relative bg-[#0D1D35] hover:bg-[#0D203B] border border-[#1B3554] ${accent.glow} rounded-2xl p-5 transition-all duration-200 shadow-lg shadow-black/20 flex flex-col justify-between`}
    >
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-medium uppercase tracking-wider text-[#94A3B8]">
            {title}
          </span>
          <div className="text-3xl font-bold tracking-tight text-[#F8FAFC] mt-2">
            {value}
          </div>
        </div>
        <div className={`p-3 rounded-xl border ${accent.iconBg} transition-transform group-hover:scale-105`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-[#1B3554]/60 flex items-center justify-between text-xs">
        {change && (
          <div
            className={`inline-flex items-center gap-0.5 font-semibold ${
              isPositive ? 'text-[#22C55E]' : 'text-[#EF4444]'
            }`}
          >
            {isPositive ? (
              <ArrowUpRight className="w-3.5 h-3.5" />
            ) : (
              <ArrowDownRight className="w-3.5 h-3.5" />
            )}
            <span>{change}</span>
          </div>
        )}
        <span className="text-[#94A3B8] truncate">{supportingText}</span>
      </div>
    </div>
  );
};
