'use client';

import React, { useState } from 'react';
import {
  FileText,
  Download,
  Eye,
  Plus,
  Filter,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowRight,
  HardDrive,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Modal } from '@/components/common/Modal';
import { ReportItem } from '@/types/football';

export const ReportsView: React.FC = () => {
  const { reports, generateReport, showToast } = useFootball();

  const [activeTab, setActiveTab] = useState<string>('All');
  const [generateModalOpen, setGenerateModalOpen] = useState<boolean>(false);
  const [viewReportModal, setViewReportModal] = useState<ReportItem | null>(null);

  // Form states for new report modal
  const [reportTitle, setReportTitle] = useState<string>('');
  const [reportMatch, setReportMatch] = useState<string>('FC Dynamo vs Rapid Stars');
  const [reportType, setReportType] = useState<'Match Report' | 'Player Report' | 'Team Performance'>('Match Report');

  const filteredReports = reports.filter((rep) => {
    if (activeTab === 'All') return true;
    return rep.type.toLowerCase().includes(activeTab.toLowerCase());
  });

  const handleCreateReport = (e: React.FormEvent) => {
    e.preventDefault();
    const finalTitle = reportTitle.trim() || `${reportType}: ${reportMatch}`;
    generateReport(finalTitle, reportMatch, reportType);
    setGenerateModalOpen(false);
    setReportTitle('');
  };

  const handleExport = (rep: ReportItem) => {
    showToast(`Downloading "${rep.title}" (${rep.fileSize})...`);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. TITLE & GENERATE REPORT BUTTON */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl sm:text-2xl font-black text-[#F8FAFC] tracking-tight">
            Reports
          </h3>
          <p className="text-xs sm:text-sm text-[#94A3B8] mt-1">
            Export comprehensive PDF/CSV analytics reports for coaches and stakeholders.
          </p>
        </div>

        <button
          onClick={() => setGenerateModalOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-[#0B5CFF] hover:bg-[#1677FF] text-white text-xs font-bold shadow-lg shadow-blue-500/25 transition-all flex items-center gap-2 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Generate Report</span>
        </button>
      </div>

      {/* 2. FILTER TABS */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {['All', 'Match', 'Player', 'Team Performance'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === tab
                ? 'bg-[#0B5CFF] text-white shadow-md shadow-blue-500/25'
                : 'bg-[#0D1D35] hover:bg-[#0D203B] text-[#94A3B8] border border-[#1B3554]'
            }`}
          >
            {tab === 'All' ? 'All Reports' : tab === 'Match' ? 'Match Reports' : tab === 'Player' ? 'Player Reports' : 'Team Reports'}
          </button>
        ))}
      </div>

      {/* 3. REPORTS LIST / TABLE */}
      <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#1B3554]">
          <span className="text-xs font-bold uppercase tracking-wider text-[#94A3B8]">
            Generated Dossiers ({filteredReports.length})
          </span>
          <span className="text-[11px] text-[#64748B] font-mono">
            Automated Computer Vision Dossiers
          </span>
        </div>

        <div className="divide-y divide-[#1B3554]/60">
          {filteredReports.map((rep) => (
            <div
              key={rep.id}
              className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#0D203B] p-3 rounded-xl transition-colors"
            >
              {/* Report Info */}
              <div className="flex items-start sm:items-center gap-3.5">
                <div className="p-3 rounded-xl bg-[#09162A] border border-[#1B3554] text-[#3B82F6] shrink-0">
                  <FileText className="w-5 h-5" />
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs sm:text-sm font-bold text-[#F8FAFC]">
                      {rep.title}
                    </h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#09162A] text-[#CBD5E1] border border-[#1B3554]">
                      {rep.type}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-[#94A3B8]">
                    <span>{rep.match}</span>
                    <span>•</span>
                    <span>{rep.date}</span>
                    <span>•</span>
                    <span className="font-mono text-[#38BDF8]">{rep.fileSize}</span>
                  </div>
                </div>
              </div>

              {/* Status & Action Buttons */}
              <div className="flex items-center justify-between md:justify-end gap-3 pl-12 sm:pl-0">
                <StatusBadge status={rep.status} size="sm" />

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewReportModal(rep)}
                    className="px-3 py-1.5 rounded-lg bg-[#09162A] hover:bg-[#152239] border border-[#1B3554] text-xs font-semibold text-[#CBD5E1] hover:text-white flex items-center gap-1.5 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View</span>
                  </button>

                  <button
                    onClick={() => handleExport(rep)}
                    className="px-3 py-1.5 rounded-lg bg-[#0B5CFF] hover:bg-[#1677FF] text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-blue-500/20"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. GENERATE REPORT MODAL */}
      <Modal
        isOpen={generateModalOpen}
        onClose={() => setGenerateModalOpen(false)}
        title="Generate New Analytics Report"
        subtitle="Compile YOLO detections, heatmaps, and physical stats into an exportable file."
      >
        <form onSubmit={handleCreateReport} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-[#CBD5E1] block mb-1">
              Report Title
            </label>
            <input
              type="text"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder="e.g. Matchday 14 Final Tactical Dossier"
              className="w-full bg-[#061122] border border-[#1B3554] rounded-xl px-3.5 py-2 text-xs text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-[#0B5CFF]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-[#CBD5E1] block mb-1">
                Report Type
              </label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value as any)}
                className="w-full bg-[#061122] border border-[#1B3554] rounded-xl px-3.5 py-2 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#0B5CFF]"
              >
                <option value="Match Report">Match Report</option>
                <option value="Player Report">Player Report</option>
                <option value="Team Performance">Team Performance</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-[#CBD5E1] block mb-1">
                Target Match / Session
              </label>
              <select
                value={reportMatch}
                onChange={(e) => setReportMatch(e.target.value)}
                className="w-full bg-[#061122] border border-[#1B3554] rounded-xl px-3.5 py-2 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#0B5CFF]"
              >
                <option value="FC Dynamo vs Rapid Stars">FC Dynamo vs Rapid Stars</option>
                <option value="Midfield Transition & Pressing Drill">Midfield Transition & Pressing Drill</option>
                <option value="Vanguard FC vs FC Dynamo">Vanguard FC vs FC Dynamo</option>
              </select>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#061122] border border-[#1B3554] text-xs text-[#94A3B8] space-y-1">
            <span className="font-bold text-white block">Included in compilation:</span>
            <p>• Full YOLO object detections (Players, Ball, Goals, Referee)</p>
            <p>• Passing matrix and tactical positioning pitch visual</p>
            <p>• Player load, sprint counts, and AI coaching recommendations</p>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={() => setGenerateModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-[#0D203B] text-xs text-[#CBD5E1] border border-[#1B3554]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#0B5CFF] hover:bg-[#1677FF] text-white text-xs font-bold shadow-md shadow-blue-500/20"
            >
              Compile & Generate
            </button>
          </div>
        </form>
      </Modal>

      {/* 5. VIEW REPORT PREVIEW MODAL */}
      <Modal
        isOpen={viewReportModal !== null}
        onClose={() => setViewReportModal(null)}
        title={viewReportModal?.title || 'Report Overview'}
        subtitle={`${viewReportModal?.match} • ${viewReportModal?.date}`}
        maxWidth="max-w-3xl"
      >
        {viewReportModal && (
          <div className="space-y-5">
            <div className="p-4 rounded-xl bg-[#061122] border border-[#1B3554] text-xs text-[#CBD5E1] leading-relaxed">
              <strong className="text-white block mb-1">Executive Summary:</strong>
              {viewReportModal.summary}
            </div>

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {viewReportModal.keyMetrics.map((km, idx) => (
                <div key={idx} className="bg-[#061122] border border-[#1B3554] rounded-xl p-3 text-center">
                  <span className="text-[10px] text-[#94A3B8] uppercase block">{km.label}</span>
                  <span className="text-base font-bold text-[#38BDF8] mt-0.5 block">{km.value}</span>
                </div>
              ))}
            </div>

            {/* Simulated Report Document Sheet */}
            <div className="p-5 rounded-2xl bg-[#020E1D] border border-[#1B3554] space-y-3 font-mono text-xs text-[#94A3B8]">
              <div className="flex justify-between border-b border-[#1B3554] pb-2 text-[11px] text-white font-bold">
                <span>DOCUMENT DOSSIER REF: #{viewReportModal.id}</span>
                <span className="text-[#22C55E]">STATUS: VERIFIED</span>
              </div>
              <p>• Model Architecture: YOLOv11x Custom Sports Weights</p>
              <p>• Optical Flow & Kalman Filter Tracking: Active</p>
              <p>• Pitch Calibration: Homography matrix 4-point pitch corner projection</p>
              <p>• Tactical Classification: Automated Pass & Shot detection neural pipeline</p>
            </div>

            <div className="flex justify-between items-center pt-2">
              <span className="text-xs text-[#64748B] font-mono">{viewReportModal.fileSize}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setViewReportModal(null)}
                  className="px-4 py-2 rounded-xl bg-[#0D203B] border border-[#1B3554] text-xs text-[#CBD5E1]"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    handleExport(viewReportModal);
                    setViewReportModal(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-[#0B5CFF] text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PDF</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
