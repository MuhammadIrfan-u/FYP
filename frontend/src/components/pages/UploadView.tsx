'use client';

import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileVideo,
  Play,
  Film,
  Sliders,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Lock,
  X,
  Sparkles,
  Clapperboard,
  ArrowRight,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { StatusBadge } from '@/components/common/StatusBadge';
import { MatchVideo } from '@/types/football';

export const UploadView: React.FC = () => {
  const {
    videos,
    uploadFootballVideo,
    deleteSession,
    playSession,
    startBackgroundSession,
    confidenceThreshold,
    setConfidenceThreshold,
    classConfidences,
    setClassConfidences,
    setActivePage,
    isUploading,
    uploadProgress,
    refreshSessions,
    isLoadingSessions,
  } = useFootball();

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [sessionTitle, setSessionTitle] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Background 5s stream annotation setup modal state
  const [modalVideo, setModalVideo] = useState<MatchVideo | null>(null);
  const [modalGlobalConf, setModalGlobalConf] = useState<number>(0.25);
  const [modalClassConfs, setModalClassConfs] = useState<Record<string, number>>({
    'football goal': 0.35,
    'football': 0.30,
    'player': 0.25,
    'player with ball': 0.25,
  });
  const [isStartingStream, setIsStartingStream] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const SUPPORTED_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
  const MAX_SIZE_MB = 2048; // 2 GB

  const validateAndSelectFile = (file: File) => {
    setValidationError(null);
    setSuccessNotice(null);

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      setValidationError(
        `Unsupported video format ".${ext}". Please upload MP4, MOV, AVI, MKV, or WEBM.`
      );
      return;
    }

    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > MAX_SIZE_MB) {
      setValidationError(
        `File size (${sizeMb.toFixed(1)} MB) exceeds the 2.0 GB Supabase Storage limit.`
      );
      return;
    }

    setSelectedFile(file);
    if (!sessionTitle) {
      setSessionTitle(file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' '));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isUploading) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isUploading) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndSelectFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSelectFile(e.target.files[0]);
    }
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile || isUploading) return;
    setValidationError(null);
    setSuccessNotice(null);

    const res = await uploadFootballVideo(selectedFile, sessionTitle);
    if (res.success) {
      setSuccessNotice(`"${sessionTitle || selectedFile.name}" was uploaded successfully.`);
      setSelectedFile(null);
      setSessionTitle('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } else if (res.error) {
      setValidationError(res.error);
    }
  };

  const handleDeleteSession = async (session: MatchVideo) => {
    const confirmDelete = window.confirm(
      `Are you sure you want to delete session "${session.matchName}"? This will delete both the storage video file and database record.`
    );
    if (!confirmDelete) return;

    setDeletingId(session.id);
    await deleteSession(session.id);
    setDeletingId(null);
  };

  const handleOpenAnnotateModal = (video: MatchVideo) => {
    setModalVideo(video);
    setModalGlobalConf(confidenceThreshold || 0.25);
    setModalClassConfs({
      'football goal': classConfidences['football goal'] ?? 0.35,
      'football': classConfidences['football'] ?? 0.30,
      'player': classConfidences['player'] ?? 0.25,
      'player with ball': classConfidences['player with ball'] ?? 0.25,
    });
  };

  const handleStartBackgroundAnnotate = async () => {
    if (!modalVideo) return;
    setIsStartingStream(true);
    setConfidenceThreshold(modalGlobalConf);
    await startBackgroundSession(modalVideo, modalClassConfs);
    setIsStartingStream(false);
    setModalVideo(null);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Title & Subtitle banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl sm:text-2xl font-black text-[#242424] tracking-tight">
            Football Video Upload
          </h3>
          <p className="text-xs sm:text-sm text-[#858585] mt-1">
            Store match clips securely in private Supabase Storage and track tactical sessions.
          </p>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FAF8F4] border border-[#E8E3D8] text-xs text-[#555555]">
          <Lock className="w-3.5 h-3.5 text-[#16A34A]" />
          <span>Private bucket: <strong className="text-[#242424] font-mono">football-videos</strong></span>
        </div>
      </div>

      {/* Sync Training Videos Banner */}
      <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#262626] text-white flex items-center justify-center shrink-0">
            <Clapperboard className="w-4 h-4 text-[#16A34A]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#242424]">Multi-Camera Training Synchronization</span>
              <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-[#DCFCE7] text-[#16A34A] border border-[#BBF7D0]">
                NEW FEATURE
              </span>
            </div>
            <p className="text-[11px] text-[#858585]">
              Upload two camera angles (e.g. sideline and behind goal) with a clap sound to align them side-by-side.
            </p>
          </div>
        </div>
        <button
          onClick={() => setActivePage('sync_training')}
          className="px-3.5 py-2 rounded-xl text-xs font-bold bg-[#262626] text-white hover:bg-[#383838] transition-all flex items-center gap-1.5 shrink-0 self-start sm:self-auto"
        >
          <span>Sync Training Videos</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Status Messages */}
      {validationError && (
        <div className="p-4 rounded-2xl bg-[#FEF2F2] border border-[#FECACA] flex items-start gap-3 text-xs text-[#991B1B]">
          <AlertCircle className="w-4 h-4 shrink-0 text-[#DC2626] mt-0.5" />
          <div className="flex-1">
            <span className="font-bold block">Upload Error</span>
            <span>{validationError}</span>
          </div>
        </div>
      )}

      {successNotice && (
        <div className="p-4 rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] flex items-start gap-3 text-xs text-[#166534]">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#16A34A] mt-0.5" />
          <div className="flex-1">
            <span className="font-bold block">Upload Successful</span>
            <span>{successNotice}</span>
          </div>
        </div>
      )}

      {/* 1. LARGE DRAG-AND-DROP UPLOAD AREA */}
      <section
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative bg-[#FAF8F4] border-2 border-dashed rounded-3xl p-6 sm:p-12 text-center transition-all duration-200 shadow-sm ${
          isDragging
            ? 'border-[#262626] bg-[#FBFAF7] scale-[1.01]'
            : 'border-[#E8E3D8] hover:border-[#D9D3C5]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.mov,.avi,.mkv,.webm"
          className="hidden"
          disabled={isUploading}
          onChange={handleFileChange}
        />

        <div className="max-w-md mx-auto flex flex-col items-center">
          {/* Upload icon circle */}
          <div className="w-20 h-20 rounded-2xl bg-[#EFEBE1] border border-[#E8E3D8] text-[#242424] flex items-center justify-center mb-5 shadow-xs transition-transform group-hover:scale-105">
            <UploadCloud
              className={`w-10 h-10 text-[#555555] ${
                isUploading ? 'animate-pulse text-[#262626]' : 'animate-bounce'
              }`}
            />
          </div>

          <h4 className="text-lg sm:text-xl font-bold text-[#242424]">
            {selectedFile ? 'Selected: ' + selectedFile.name : 'Drag and drop your football video'}
          </h4>

          {selectedFile && (
            <p className="text-xs text-[#858585] mt-1 font-mono">
              Size: {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          )}

          {/* Session Title input */}
          <div className="w-full mt-4 text-left">
            <label className="block text-xs font-bold text-[#242424] mb-1">
              Session Title (Optional)
            </label>
            <input
              type="text"
              value={sessionTitle}
              disabled={isUploading}
              onChange={(e) => setSessionTitle(e.target.value)}
              placeholder="e.g. FC Dynamo vs Rapid Stars - 1st Half"
              className="w-full px-3.5 py-2 text-xs rounded-xl bg-[#FBFAF7] border border-[#E8E3D8] text-[#242424] placeholder-[#858585] focus:outline-none focus:border-[#262626] transition-colors"
            />
          </div>

          {/* Upload progress indicator */}
          {isUploading && (
            <div className="w-full mt-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-[#242424]">
                <span>Uploading to Supabase Storage...</span>
                <span className="font-mono">{uploadProgress}%</span>
              </div>
              <div className="w-full h-2.5 bg-[#E8E3D8] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#262626] transition-all duration-300 rounded-full"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-[11px] text-[#858585]">
                Please do not close this window while the file is transferring.
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 w-full">
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-2.5 rounded-xl bg-[#FAF8F4] hover:bg-[#EEEBE3] border border-[#D9D3C5] text-[#242424] text-xs font-bold shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <FileVideo className="w-4 h-4 text-[#555555]" />
              <span>{selectedFile ? 'Change File' : 'Browse File'}</span>
            </button>

            {selectedFile && (
              <button
                type="button"
                disabled={isUploading}
                onClick={handleUploadSubmit}
                className="px-6 py-2.5 rounded-xl bg-[#262626] hover:bg-[#171717] disabled:bg-[#858585] text-white text-xs font-bold shadow-sm transition-all flex items-center gap-2 cursor-pointer"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4" />
                    <span>Upload Session</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Supported formats note */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs text-[#858585]">
            <span className="px-2.5 py-1 rounded-md bg-[#EEEBE3] border border-[#E8E3D8] font-mono text-[11px] text-[#404040]">
              Supported: MP4, MOV, AVI, MKV, WEBM
            </span>
            <span className="text-[#D9D3C5]">•</span>
            <span className="font-medium text-[#858585]">
              Max file size: <strong className="text-[#242424]">2.0 GB</strong>
            </span>
          </div>
        </div>
      </section>

      {/* 2. RECENT UPLOADS TABLE / SESSIONS LIST */}
      <section className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#E8E3D8]">
          <div>
            <h4 className="text-base font-bold text-[#242424]">
              Your Football Sessions
            </h4>
            <p className="text-xs text-[#858585]">
              Sessions stored in PostgreSQL (public.sessions) with videos in Supabase Storage.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => refreshSessions()}
              disabled={isLoadingSessions}
              className="p-1.5 rounded-lg hover:bg-[#EEEBE3] text-[#555555] hover:text-[#242424] transition-colors"
              title="Refresh sessions list"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSessions ? 'animate-spin' : ''}`} />
            </button>
            <span className="text-xs font-mono text-[#858585]">
              {videos.length} sessions logged
            </span>
          </div>
        </div>

        {/* Empty State */}
        {videos.length === 0 ? (
          <div className="py-12 text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-[#EEEBE3] flex items-center justify-center text-[#858585] mb-3 border border-[#E8E3D8]">
              <FileVideo className="w-6 h-6" />
            </div>
            <h5 className="text-sm font-bold text-[#242424]">No sessions uploaded yet</h5>
            <p className="text-xs text-[#858585] max-w-sm mt-1">
              Select or drag a match video above to upload your first football session to Supabase.
            </p>
          </div>
        ) : (
          /* Video Rows */
          <div className="divide-y divide-[#E8E3D8]">
            {videos.map((vid) => {
              const isDeleting = deletingId === vid.id;

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
                        <span className="truncate max-w-[160px] sm:max-w-[220px]" title={vid.filename}>
                          {vid.filename}
                        </span>
                        <span>•</span>
                        <span>{vid.date}</span>
                        <span>•</span>
                        <span>{vid.duration}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status & Actions */}
                  <div className="flex items-center justify-between md:justify-end gap-3 w-full md:w-auto">
                    {/* Status Badge */}
                    <div className="flex items-center gap-2">
                      <StatusBadge status={vid.status} />
                    </div>

                    {/* Play Video / View Results via Signed URL (Live Mode) */}
                    <button
                      onClick={() => playSession(vid)}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all bg-[#262626] hover:bg-[#171717] text-white shadow-2xs cursor-pointer"
                      title="Play video with real-time live detection"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>Play & Inspect</span>
                    </button>

                    {/* Background 5s Chunked Video Inference */}
                    <button
                      onClick={() => handleOpenAnnotateModal(vid)}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all bg-[#16A34A] hover:bg-[#15803D] text-white shadow-2xs cursor-pointer"
                      title="Break video into 5-second subvideos, annotate in background, and stream progressively so you don't get bored"
                    >
                      <Film className="w-3.5 h-3.5 fill-white" />
                      <span>5s Stream & Annotate</span>
                    </button>

                    {/* Delete Session Button */}
                    <button
                      onClick={() => handleDeleteSession(vid)}
                      disabled={isDeleting}
                      className="p-2 rounded-xl text-xs font-semibold flex items-center justify-center transition-all bg-[#FAF8F4] hover:bg-[#FEF2F2] border border-[#E8E3D8] text-[#858585] hover:text-[#DC2626] hover:border-[#FECACA] cursor-pointer disabled:opacity-50"
                      title="Delete session and video file"
                    >
                      {isDeleting ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#DC2626]" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 5s Chunked Background Stream & Per-Class Confidence Modal */}
      {modalVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-[#FAF8F4] border border-[#E8E3D8] rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-6 relative max-h-[90vh] overflow-y-auto">
            {/* Close button */}
            <button
              onClick={() => setModalVideo(null)}
              className="absolute top-5 right-5 p-2 rounded-xl text-[#858585] hover:text-[#242424] hover:bg-[#EEEBE3] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header */}
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#ECFDF5] border border-[#A7F3D0] text-[#065F46] text-xs font-semibold mb-2">
                <Sparkles className="w-3.5 h-3.5" />
                <span>5-Second Progressive Video Engine</span>
              </div>
              <h3 className="text-xl font-black text-[#242424] tracking-tight">
                Background Video Annotation
              </h3>
              <p className="text-xs text-[#858585] mt-1">
                Target session: <strong className="text-[#242424]">{modalVideo.matchName}</strong> ({modalVideo.filename})
              </p>
            </div>

            {/* Concept callout */}
            <div className="p-4 rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] text-xs text-[#166534] space-y-1.5">
              <div className="font-bold flex items-center gap-1.5">
                <Film className="w-4 h-4 text-[#16A34A]" />
                <span>No Long Video Waiting (Chunked Streaming)</span>
              </div>
              <p className="text-[11px] leading-relaxed text-[#14532D]">
                Big videos are partitioned into <strong>5-second subvideos</strong>. As soon as each 5s segment finishes YOLO tactical annotation in the background, it begins playing immediately so you never get bored waiting!
              </p>
            </div>

            {/* Confidence Controls */}
            <div className="space-y-4">
              {/* Global Confidence Threshold */}
              <div className="p-4 rounded-2xl bg-white border border-[#E8E3D8] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[#242424] flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-[#262626]" />
                    <span>Global Confidence Threshold</span>
                  </label>
                  <span className="text-xs font-mono font-bold text-[#16A34A] px-2 py-0.5 rounded-lg bg-[#F0FDF4]">
                    {Math.round(modalGlobalConf * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.05"
                  value={modalGlobalConf}
                  onChange={(e) => setModalGlobalConf(parseFloat(e.target.value))}
                  className="w-full accent-[#16A34A] cursor-pointer"
                />
                <p className="text-[10px] text-[#858585]">
                  Baseline threshold for detection candidates. Detections below this or class thresholds are discarded.
                </p>
              </div>

              {/* Per-Class Confidence Thresholds */}
              <div className="p-4 rounded-2xl bg-white border border-[#E8E3D8] space-y-3">
                <div className="flex items-center justify-between border-b border-[#F0ECE4] pb-2">
                  <span className="text-xs font-bold text-[#242424]">
                    Per-Class Separate Confidences
                  </span>
                  <span className="text-[10px] font-mono text-[#858585]">
                    Independent filters
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Football Goal (Requested 35%) */}
                  <div className="p-3 rounded-xl bg-[#FAF8F4] border border-[#E8E3D8] space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#242424] flex items-center gap-1.5">
                        <span>🥅</span> Football Goal
                      </span>
                      <span className="font-mono font-bold text-[#D97706] text-[11px]">
                        {Math.round((modalClassConfs['football goal'] ?? 0.35) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="0.95"
                      step="0.05"
                      value={modalClassConfs['football goal'] ?? 0.35}
                      onChange={(e) =>
                        setModalClassConfs((prev) => ({
                          ...prev,
                          'football goal': parseFloat(e.target.value),
                        }))
                      }
                      className="w-full accent-[#D97706] cursor-pointer"
                    />
                    <div className="text-[9px] text-[#858585]">Discard goals &lt; {Math.round((modalClassConfs['football goal'] ?? 0.35) * 100)}%</div>
                  </div>

                  {/* Football (Ball) */}
                  <div className="p-3 rounded-xl bg-[#FAF8F4] border border-[#E8E3D8] space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#242424] flex items-center gap-1.5">
                        <span>⚽</span> Football (Ball)
                      </span>
                      <span className="font-mono font-bold text-[#16A34A] text-[11px]">
                        {Math.round((modalClassConfs['football'] ?? 0.30) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="0.95"
                      step="0.05"
                      value={modalClassConfs['football'] ?? 0.30}
                      onChange={(e) =>
                        setModalClassConfs((prev) => ({
                          ...prev,
                          football: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full accent-[#16A34A] cursor-pointer"
                    />
                    <div className="text-[9px] text-[#858585]">Discard ball &lt; {Math.round((modalClassConfs['football'] ?? 0.30) * 100)}%</div>
                  </div>

                  {/* Player */}
                  <div className="p-3 rounded-xl bg-[#FAF8F4] border border-[#E8E3D8] space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#242424] flex items-center gap-1.5">
                        <span>🏃</span> Player
                      </span>
                      <span className="font-mono font-bold text-[#2563EB] text-[11px]">
                        {Math.round((modalClassConfs['player'] ?? 0.25) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="0.95"
                      step="0.05"
                      value={modalClassConfs['player'] ?? 0.25}
                      onChange={(e) =>
                        setModalClassConfs((prev) => ({
                          ...prev,
                          player: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full accent-[#2563EB] cursor-pointer"
                    />
                    <div className="text-[9px] text-[#858585]">Discard players &lt; {Math.round((modalClassConfs['player'] ?? 0.25) * 100)}%</div>
                  </div>

                  {/* Player with Ball */}
                  <div className="p-3 rounded-xl bg-[#FAF8F4] border border-[#E8E3D8] space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#242424] flex items-center gap-1.5">
                        <span>👟⚽</span> Player with Ball
                      </span>
                      <span className="font-mono font-bold text-[#9333EA] text-[11px]">
                        {Math.round((modalClassConfs['player with ball'] ?? 0.25) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="0.95"
                      step="0.05"
                      value={modalClassConfs['player with ball'] ?? 0.25}
                      onChange={(e) =>
                        setModalClassConfs((prev) => ({
                          ...prev,
                          'player with ball': parseFloat(e.target.value),
                        }))
                      }
                      className="w-full accent-[#9333EA] cursor-pointer"
                    />
                    <div className="text-[9px] text-[#858585]">Discard dribblers &lt; {Math.round((modalClassConfs['player with ball'] ?? 0.25) * 100)}%</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E8E3D8]">
              <button
                onClick={() => setModalVideo(null)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#858585] hover:text-[#242424] hover:bg-[#EEEBE3] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleStartBackgroundAnnotate}
                disabled={isStartingStream}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-[#16A34A] hover:bg-[#15803D] transition-all flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {isStartingStream ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Launching Background Job...</span>
                  </>
                ) : (
                  <>
                    <Film className="w-4 h-4 fill-white" />
                    <span>Start 5s Background Stream</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
