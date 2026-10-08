'use client';

import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileVideo,
  CheckCircle2,
  AlertCircle,
  Eye,
  Film,
  Sparkles,
  ArrowRight,
  HardDrive,
  Cpu,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { StatusBadge } from '@/components/common/StatusBadge';
import { MatchVideo } from '@/types/football';

export const UploadView: React.FC = () => {
  const { videos, simulateUpload, setActiveVideo, setActivePage } = useFootball();
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      simulateUpload(file.name, `${sizeMb} MB`);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      simulateUpload(file.name, `${sizeMb} MB`);
    }
  };

  const handleViewResults = (video: MatchVideo) => {
    setActiveVideo(video);
    setActivePage('analysis');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Title & Subtitle banner */}
      <div>
        <h3 className="text-xl sm:text-2xl font-black text-[#F8FAFC] tracking-tight">
          Upload Video
        </h3>
        <p className="text-xs sm:text-sm text-[#94A3B8] mt-1">
          Upload a match or training session to get AI-powered analysis.
        </p>
      </div>

      {/* 1. LARGE DRAG-AND-DROP UPLOAD AREA */}
      <section
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative bg-[#0D1D35] border-2 border-dashed rounded-3xl p-8 sm:p-14 text-center transition-all duration-200 shadow-xl ${
          isDragging
            ? 'border-[#0B5CFF] bg-[#0D203B] scale-[1.01]'
            : 'border-[#1B3554] hover:border-[#284255]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.mov,.avi,.mkv"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="max-w-md mx-auto flex flex-col items-center">
          {/* Upload icon circle with tech glow */}
          <div className="w-20 h-20 rounded-2xl bg-[#09162A] border border-[#1B3554] text-[#3B82F6] flex items-center justify-center mb-5 shadow-lg shadow-blue-500/10 group-hover:scale-105 transition-transform">
            <UploadCloud className="w-10 h-10 animate-bounce" />
          </div>

          <h4 className="text-lg sm:text-xl font-bold text-[#F8FAFC]">
            Drag and drop your video here
          </h4>

          <div className="my-3 flex items-center justify-center gap-3 w-full">
            <div className="h-px bg-[#1B3554] flex-1" />
            <span className="text-xs uppercase text-[#64748B] font-semibold">
              or
            </span>
            <div className="h-px bg-[#1B3554] flex-1" />
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-6 py-3 rounded-xl bg-[#0B5CFF] hover:bg-[#1677FF] text-white text-xs sm:text-sm font-bold shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2"
          >
            <FileVideo className="w-4 h-4" />
            <span>Choose File</span>
          </button>

          {/* Formats and size limits */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs text-[#94A3B8]">
            <span className="px-2.5 py-1 rounded-md bg-[#09162A] border border-[#1B3554] font-mono text-[11px] text-[#CBD5E1]">
              Supported: MP4, MOV, AVI, MKV
            </span>
            <span className="text-[#64748B]">•</span>
            <span className="font-medium text-[#64748B]">
              Max file size: <strong className="text-[#CBD5E1]">2.0 GB</strong>
            </span>
          </div>

          {/* YOLO AI Pipeline Steps Preview */}
          <div className="mt-8 pt-6 border-t border-[#1B3554]/70 w-full grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-[#94A3B8]">
            <div className="p-2 rounded-lg bg-[#09162A]/60 border border-[#1B3554]/50">
              <span className="font-bold text-[#3B82F6] block">Step 1</span>
              <span>Frame Ingestion</span>
            </div>
            <div className="p-2 rounded-lg bg-[#09162A]/60 border border-[#1B3554]/50">
              <span className="font-bold text-[#FBBF24] block">Step 2</span>
              <span>YOLO Detections</span>
            </div>
            <div className="p-2 rounded-lg bg-[#09162A]/60 border border-[#1B3554]/50">
              <span className="font-bold text-[#06B6D4] block">Step 3</span>
              <span>Player Tracking</span>
            </div>
            <div className="p-2 rounded-lg bg-[#09162A]/60 border border-[#1B3554]/50">
              <span className="font-bold text-[#8B5CF6] block">Step 4</span>
              <span>Tactical Analytics</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. RECENT UPLOADS TABLE / LIST */}
      <section className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#1B3554]">
          <div>
            <h4 className="text-base font-bold text-[#F8FAFC]">
              Recent Uploads
            </h4>
            <p className="text-xs text-[#94A3B8]">
              Status and analysis history for matches and training sessions.
            </p>
          </div>
          <span className="text-xs font-mono text-[#94A3B8]">
            {videos.length} sessions logged
          </span>
        </div>

        {/* Video Rows */}
        <div className="divide-y divide-[#1B3554]/60">
          {videos.map((vid) => {
            const isCompleted = vid.status === 'Completed';
            const isFailed = vid.status === 'Failed';

            return (
              <div
                key={vid.id}
                className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#0D203B]/60 p-3 rounded-xl transition-colors"
              >
                {/* Thumbnail & Video Info */}
                <div className="flex items-center gap-3.5">
                  <div className="relative w-20 h-14 rounded-lg overflow-hidden bg-[#061122] border border-[#1B3554] shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={vid.thumbnail}
                      alt={vid.filename}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0.5 right-1 px-1 rounded bg-black/80 text-[9px] font-mono text-white">
                      {vid.duration}
                    </div>
                  </div>

                  <div>
                    <h5 className="text-xs sm:text-sm font-bold text-[#F8FAFC] tracking-tight hover:text-[#3B82F6] transition-colors">
                      {vid.matchName}
                    </h5>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-[#94A3B8] font-mono">
                      <span>{vid.filename}</span>
                      <span>•</span>
                      <span>{vid.date}</span>
                      <span>•</span>
                      <span>{vid.size}</span>
                    </div>
                  </div>
                </div>

                {/* Status & Progress & Action */}
                <div className="flex items-center justify-between md:justify-end gap-4 w-full md:w-auto">
                  {/* Status Badge */}
                  <div className="flex items-center gap-2">
                    <StatusBadge status={vid.status} />
                    {!isCompleted && !isFailed && (
                      <span className="text-[11px] font-mono text-[#94A3B8]">
                        {vid.progress}%
                      </span>
                    )}
                  </div>

                  {/* View Results Button */}
                  <button
                    disabled={!isCompleted}
                    onClick={() => handleViewResults(vid)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      isCompleted
                        ? 'bg-[#0B5CFF] hover:bg-[#1677FF] text-white shadow-md shadow-blue-500/20'
                        : 'bg-[#152239] text-[#64748B] cursor-not-allowed border border-[#1B3554]'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View Results</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
