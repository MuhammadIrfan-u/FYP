import React from 'react';
import { VideoStatus } from '@/types/football';
import { CheckCircle2, Clock, AlertCircle, RefreshCw, Cpu } from 'lucide-react';

interface StatusBadgeProps {
  status: VideoStatus | string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const isSm = size === 'sm';

  switch (status) {
    case 'Completed':
    case 'Ready':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs tracking-wide'
          }`}
        >
          <CheckCircle2 className={isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          {status}
        </span>
      );

    case 'Processing':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-[#FBBF24]/15 text-[#FBBF24] border border-[#FBBF24]/30 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <Clock className={`animate-spin ${isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
          {status}
        </span>
      );

    case 'Analysing':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-[#8B5CF6]/15 text-[#8B5CF6] border border-[#8B5CF6]/30 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <Cpu className={`animate-pulse ${isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
          {status}
        </span>
      );

    case 'Uploading':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-[#0B5CFF]/15 text-[#3B82F6] border border-[#0B5CFF]/30 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <RefreshCw className={`animate-spin ${isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
          {status}
        </span>
      );

    case 'Failed':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <AlertCircle className={isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          {status}
        </span>
      );

    default:
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-[#1B3554]/50 text-[#CBD5E1] border border-[#1B3554] ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          {status}
        </span>
      );
  }
};
