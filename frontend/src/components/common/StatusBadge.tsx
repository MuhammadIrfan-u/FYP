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
          className={`inline-flex items-center gap-1.5 font-semibold rounded-full bg-[#16A34A]/10 text-[#16A34A] border border-[#16A34A]/30 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs tracking-wide'
          }`}
        >
          <CheckCircle2 className={isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          {status}
        </span>
      );

    case 'Uploaded':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-semibold rounded-full bg-[#0284C7]/10 text-[#0284C7] border border-[#0284C7]/30 ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs tracking-wide'
          }`}
        >
          <CheckCircle2 className={isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          Uploaded
        </span>
      );

    case 'Processing':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-semibold rounded-full bg-[#D97706]/10 text-[#D97706] border border-[#D97706]/30 ${
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
          className={`inline-flex items-center gap-1.5 font-semibold rounded-full bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/30 ${
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
          className={`inline-flex items-center gap-1.5 font-semibold rounded-full bg-[#2563EB]/10 text-[#2563EB] border border-[#2563EB]/30 ${
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
          className={`inline-flex items-center gap-1.5 font-semibold rounded-full bg-[#DC2626]/10 text-[#DC2626] border border-[#DC2626]/30 ${
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
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-[#EEEBE3] text-[#404040] border border-[#E8E3D8] ${
            isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
          }`}
        >
          {status}
        </span>
      );
  }
};
