'use client';

import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileVideo,
  Eye,
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
        <h3 className="text-xl sm:text-2xl font-black text-[#242424] tracking-tight">
          Upload Video
        </h3>
        <p className="text-xs sm:text-sm text-[#858585] mt-1">
          Upload a match or training session to get AI-powered analysis.
        </p>
      </div>

      {/* 1. LARGE DRAG-AND-DROP UPLOAD AREA */}
      <section
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative bg-[#FAF8F4] border-2 border-dashed rounded-3xl p-8 sm:p-14 text-center transition-all duration-200 shadow-sm ${
          isDragging
            ? 'border-[#262626] bg-[#FBFAF7] scale-[1.01]'
            : 'border-[#E8E3D8] hover:border-[#D9D3C5]'
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
          {/* Upload icon circle in cream container */}
          <div className="w-20 h-20 rounded-2xl bg-[#EFEBE1] border border-[#E8E3D8] text-[#242424] flex items-center justify-center mb-5 shadow-xs transition-transform group-hover:scale-105">
            <UploadCloud className="w-10 h-10 text-[#555555] animate-bounce" />
          </div>

          <h4 className="text-lg sm:text-xl font-bold text-[#242424]">
            Drag and drop your video here
          </h4>

          <div className="my-3 flex items-center justify-center gap-3 w-full">
            <div className="h-px bg-[#E8E3D8] flex-1" />
            <span className="text-xs uppercase text-[#858585] font-semibold">
              or
            </span>
            <div className="h-px bg-[#E8E3D8] flex-1" />
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-6 py-3 rounded-xl bg-[#262626] hover:bg-[#171717] text-white text-xs sm:text-sm font-bold shadow-sm transition-all flex items-center gap-2"
          >
            <FileVideo className="w-4 h-4" />
            <span>Choose File</span>
          </button>

          {/* Formats and size limits */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs text-[#858585]">
            <span className="px-2.5 py-1 rounded-md bg-[#EEEBE3] border border-[#E8E3D8] font-mono text-[11px] text-[#404040]">
              Supported: MP4, MOV, AVI, MKV
            </span>
            <span className="text-[#D9D3C5]">•</span>
            <span className="font-medium text-[#858585]">
              Max file size: <strong className="text-[#242424]">2.0 GB</strong>
            </span>
          </div>

          {/* YOLO AI Pipeline Steps Preview */}
          <div className="mt-8 pt-6 border-t border-[#E8E3D8] w-full grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-[#858585]">
            <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#E8E3D8]">
              <span className="font-bold text-[#2563EB] block">Step 1</span>
              <span>Frame Ingestion</span>
            </div>
            <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#E8E3D8]">
              <span className="font-bold text-[#D97706] block">Step 2</span>
              <span>YOLO Detections</span>
            </div>
            <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#E8E3D8]">
              <span className="font-bold text-[#16A34A] block">Step 3</span>
              <span>Player Tracking</span>
            </div>
            <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#E8E3D8]">
              <span className="font-bold text-[#7C3AED] block">Step 4</span>
              <span>Tactical Analytics</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. RECENT UPLOADS TABLE / LIST */}
      <section className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
          <div>
            <h4 className="text-base font-bold text-[#242424]">
              Recent Uploads
            </h4>
            <p className="text-xs text-[#858585]">
              Status and analysis history for matches and training sessions.
            </p>
          </div>
          <span className="text-xs font-mono text-[#858585]">
            {videos.length} sessions logged
          </span>
        </div>

        {/* Video Rows */}
        <div className="divide-y divide-[#E8E3D8]">
          {videos.map((vid) => {
            const isCompleted = vid.status === 'Completed';
            const isFailed = vid.status === 'Failed';

            return (
              <div
                key={vid.id}
                className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#FBFAF7] p-3 rounded-xl transition-colors"
              >
                {/* Thumbnail & Video Info */}
                <div className="flex items-center gap-3.5">
                  <div className="relative w-20 h-14 rounded-lg overflow-hidden bg-[#EEEBE3] border border-[#E8E3D8] shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={vid.thumbnail}
                      alt={vid.filename}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0.5 right-1 px-1 rounded bg-[#262626]/80 text-[9px] font-mono text-white">
                      {vid.duration}
                    </div>
                  </div>

                  <div>
                    <h5 className="text-xs sm:text-sm font-bold text-[#242424] tracking-tight hover:text-[#171717] transition-colors">
                      {vid.matchName}
                    </h5>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-[#858585] font-mono">
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
                      <span className="text-[11px] font-mono text-[#858585]">
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
                        ? 'bg-[#262626] hover:bg-[#171717] text-white shadow-2xs'
                        : 'bg-[#EEEBE3] text-[#858585] cursor-not-allowed border border-[#E8E3D8]'
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
