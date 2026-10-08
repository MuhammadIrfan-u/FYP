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
}) => {
  return (
    <div className="group relative bg-[#FAF8F4] hover:bg-[#FBFAF7] border border-[#E8E3D8] hover:border-[#D9D3C5] rounded-2xl p-5 transition-all duration-200 shadow-2xs flex flex-col justify-between">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-[#858585]">
            {title}
          </span>
          <div className="text-3xl font-extrabold tracking-tight text-[#242424] mt-2">
            {value}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[#EFEBE1] border border-[#E8E3D8] text-[#242424] transition-transform group-hover:scale-105">
          <Icon className="w-5 h-5 text-[#555555]" />
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-[#E8E3D8] flex items-center justify-between text-xs">
        {change && (
          <div
            className={`inline-flex items-center gap-0.5 font-bold ${
              isPositive ? 'text-[#16A34A]' : 'text-[#DC2626]'
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
        <span className="text-[#858585] truncate font-medium">{supportingText}</span>
      </div>
    </div>
  );
};
