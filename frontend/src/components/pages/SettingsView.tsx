'use client';

import React, { useState } from 'react';
import {
  Settings,
  Shield,
  Users,
  Sliders,
  CheckCircle2,
  Save,
  Palette,
  Cpu,
  Bell,
} from 'lucide-react';
import { useFootball } from '@/context/FootballContext';

export const SettingsView: React.FC = () => {
  const { settings, updateSettings, players, showToast } = useFootball();

  const [activeTab, setActiveTab] = useState<'profile' | 'players' | 'preferences'>('profile');

  // Form states
  const [formData, setFormData] = useState({
    teamName: settings.teamName,
    coachName: settings.coachName,
    coachLicense: settings.coachLicense,
    season: settings.season,
    formation: settings.formation,
    primaryColor: settings.primaryColor,
    secondaryColor: settings.secondaryColor,
    stadium: settings.stadium,
    autoDetectHeatmaps: settings.autoDetectHeatmaps,
    yoloThreshold: settings.yoloThreshold,
    frameSamplingRate: settings.frameSamplingRate,
    alertOnHighFatigue: settings.alertOnHighFatigue,
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings(formData);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. TITLE & SUBTITLE */}
      <div>
        <h3 className="text-xl sm:text-2xl font-black text-[#F8FAFC] tracking-tight">
          Settings
        </h3>
        <p className="text-xs sm:text-sm text-[#94A3B8] mt-1">
          Configure team parameters, computer vision thresholds, and coaching preferences.
        </p>
      </div>

      {/* 2. TAB PILLS */}
      <div className="flex items-center gap-2 border-b border-[#1B3554]/70 pb-2">
        <button
          onClick={() => setActiveTab('profile')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'profile'
              ? 'bg-[#0B5CFF] text-white shadow-md shadow-blue-500/25'
              : 'text-[#94A3B8] hover:bg-[#0D203B] hover:text-[#F8FAFC]'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Team Profile</span>
        </button>

        <button
          onClick={() => setActiveTab('players')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'players'
              ? 'bg-[#0B5CFF] text-white shadow-md shadow-blue-500/25'
              : 'text-[#94A3B8] hover:bg-[#0D203B] hover:text-[#F8FAFC]'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Squad Roster</span>
        </button>

        <button
          onClick={() => setActiveTab('preferences')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'preferences'
              ? 'bg-[#0B5CFF] text-white shadow-md shadow-blue-500/25'
              : 'text-[#94A3B8] hover:bg-[#0D203B] hover:text-[#F8FAFC]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>AI & Vision Preferences</span>
        </button>
      </div>

      {/* 3. SECTION 1: TEAM PROFILE */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSave} className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-[#1B3554]">
            <div>
              <h4 className="text-base font-bold text-[#F8FAFC]">
                Team Profile & Tactical Identity
              </h4>
              <p className="text-xs text-[#94A3B8]">
                General details displayed across reports, pitch diagrams, and video telemetry.
              </p>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-[#0B5CFF] hover:bg-[#1677FF] text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-blue-500/20"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Changes</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="text-xs font-bold text-[#CBD5E1] block mb-1.5">
                Team Name
              </label>
              <input
                type="text"
                value={formData.teamName}
                onChange={(e) => setFormData({ ...formData, teamName: e.target.value })}
                className="w-full bg-[#061122] border border-[#1B3554] rounded-xl px-4 py-2.5 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#0B5CFF]"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[#CBD5E1] block mb-1.5">
                Head Coach Name
              </label>
              <input
                type="text"
                value={formData.coachName}
                onChange={(e) => setFormData({ ...formData, coachName: e.target.value })}
                className="w-full bg-[#061122] border border-[#1B3554] rounded-xl px-4 py-2.5 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#0B5CFF]"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[#CBD5E1] block mb-1.5">
                Coaching License
              </label>
              <input
                type="text"
                value={formData.coachLicense}
                onChange={(e) => setFormData({ ...formData, coachLicense: e.target.value })}
                className="w-full bg-[#061122] border border-[#1B3554] rounded-xl px-4 py-2.5 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#0B5CFF]"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[#CBD5E1] block mb-1.5">
                Current Season / Competition
              </label>
              <input
                type="text"
                value={formData.season}
                onChange={(e) => setFormData({ ...formData, season: e.target.value })}
                className="w-full bg-[#061122] border border-[#1B3554] rounded-xl px-4 py-2.5 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#0B5CFF]"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[#CBD5E1] block mb-1.5">
                Default Formation
              </label>
              <select
                value={formData.formation}
                onChange={(e) => setFormData({ ...formData, formation: e.target.value })}
                className="w-full bg-[#061122] border border-[#1B3554] rounded-xl px-4 py-2.5 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#0B5CFF]"
              >
                <option value="4-3-3 Attacking">4-3-3 Attacking</option>
                <option value="4-2-3-1 Modern">4-2-3-1 Modern</option>
                <option value="3-5-2 Wingback">3-5-2 Wingback</option>
                <option value="4-4-2 Diamond">4-4-2 Diamond</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-[#CBD5E1] block mb-1.5">
                Home Stadium
              </label>
              <input
                type="text"
                value={formData.stadium}
                onChange={(e) => setFormData({ ...formData, stadium: e.target.value })}
                className="w-full bg-[#061122] border border-[#1B3554] rounded-xl px-4 py-2.5 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#0B5CFF]"
              />
            </div>

            {/* Team Colours */}
            <div>
              <label className="text-xs font-bold text-[#CBD5E1] block mb-1.5">
                Primary Team Color
              </label>
              <div className="flex items-center gap-3 bg-[#061122] border border-[#1B3554] rounded-xl p-2 px-3">
                <input
                  type="color"
                  value={formData.primaryColor}
                  onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
                  className="w-8 h-8 rounded-lg bg-transparent cursor-pointer border-none"
                />
                <span className="font-mono text-xs text-[#CBD5E1]">{formData.primaryColor}</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-[#CBD5E1] block mb-1.5">
                Secondary Accent Color
              </label>
              <div className="flex items-center gap-3 bg-[#061122] border border-[#1B3554] rounded-xl p-2 px-3">
                <input
                  type="color"
                  value={formData.secondaryColor}
                  onChange={(e) => setFormData({ ...formData, secondaryColor: e.target.value })}
                  className="w-8 h-8 rounded-lg bg-transparent cursor-pointer border-none"
                />
                <span className="font-mono text-xs text-[#CBD5E1]">{formData.secondaryColor}</span>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* 4. SECTION 2: SQUAD ROSTER */}
      {activeTab === 'players' && (
        <div className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-6 sm:p-8 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#1B3554]">
            <div>
              <h4 className="text-base font-bold text-[#F8FAFC]">
                Squad Roster & Player Tracking Identifiers
              </h4>
              <p className="text-xs text-[#94A3B8]">
                Registered players recognized by the YOLO computer vision neural model.
              </p>
            </div>
            <span className="text-xs font-mono text-[#38BDF8]">
              {players.length} Active Profiles
            </span>
          </div>

          <div className="divide-y divide-[#1B3554]/60">
            {players.map((p) => (
              <div key={p.id} className="py-3.5 flex items-center justify-between hover:bg-[#0D203B] px-3 rounded-xl transition-colors">
                <div className="flex items-center gap-3.5">
                  <div className="w-9 h-9 rounded-xl bg-[#09162A] border border-[#1B3554] flex items-center justify-center font-mono font-bold text-[#3B82F6] text-xs">
                    #{p.number}
                  </div>
                  <div>
                    <h5 className="text-xs sm:text-sm font-bold text-[#F8FAFC]">
                      {p.name}
                    </h5>
                    <span className="text-[11px] text-[#94A3B8] font-medium">
                      {p.position} • {p.role}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-[#22C55E] font-bold hidden sm:inline">
                    Rating: {p.rating}
                  </span>
                  <span className="text-[#CBD5E1] hidden sm:inline">
                    {p.distanceCovered}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#22C55E]/15 text-[#22C55E] text-[10px] font-bold">
                    ACTIVE
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. SECTION 3: PREFERENCES & AI VISION SETTINGS */}
      {activeTab === 'preferences' && (
        <form onSubmit={handleSave} className="bg-[#0D1D35] border border-[#1B3554] rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-[#1B3554]">
            <div>
              <h4 className="text-base font-bold text-[#F8FAFC]">
                AI & YOLO Computer Vision Settings
              </h4>
              <p className="text-xs text-[#94A3B8]">
                Adjust model inference thresholds, sampling frequency, and automated analytics.
              </p>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-[#0B5CFF] hover:bg-[#1677FF] text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-blue-500/20"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Changes</span>
            </button>
          </div>

          <div className="space-y-6">
            {/* YOLO Threshold */}
            <div className="p-4 rounded-xl bg-[#061122] border border-[#1B3554] space-y-2">
              <div className="flex justify-between items-center text-xs">
                <div>
                  <span className="font-bold text-[#F8FAFC] block">
                    Default YOLO Detection Confidence Threshold
                  </span>
                  <span className="text-[11px] text-[#94A3B8]">
                    Detections below this score are filtered from bounding box rendering.
                  </span>
                </div>
                <span className="font-mono font-bold text-[#3B82F6] text-sm">
                  {formData.yoloThreshold.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.8"
                step="0.05"
                value={formData.yoloThreshold}
                onChange={(e) => setFormData({ ...formData, yoloThreshold: parseFloat(e.target.value) })}
                className="w-full accent-[#0B5CFF] h-2 bg-[#09162A] rounded-lg cursor-pointer"
              />
            </div>

            {/* Frame Sampling Rate */}
            <div className="p-4 rounded-xl bg-[#061122] border border-[#1B3554] space-y-2">
              <div className="flex justify-between items-center text-xs">
                <div>
                  <span className="font-bold text-[#F8FAFC] block">
                    Optical Sampling Frequency (Frames Per Second)
                  </span>
                  <span className="text-[11px] text-[#94A3B8]">
                    Higher FPS yields smoother trajectory curves with increased GPU load.
                  </span>
                </div>
                <span className="font-mono font-bold text-[#22C55E] text-sm">
                  {formData.frameSamplingRate} FPS
                </span>
              </div>
              <div className="flex gap-2">
                {[15, 25, 30, 60].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setFormData({ ...formData, frameSamplingRate: rate })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold border ${
                      formData.frameSamplingRate === rate
                        ? 'bg-[#0B5CFF] text-white border-[#0B5CFF]'
                        : 'bg-[#09162A] text-[#94A3B8] border-[#1B3554]'
                    }`}
                  >
                    {rate} FPS
                  </button>
                ))}
              </div>
            </div>

            {/* Toggle 1: Auto-Detect Heatmaps */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-[#061122] border border-[#1B3554]">
              <div>
                <span className="text-xs font-bold text-[#F8FAFC] block">
                  Auto-Compute Territorial Heatmaps
                </span>
                <span className="text-[11px] text-[#94A3B8]">
                  Automatically generate spatial intensity overlays upon video upload.
                </span>
              </div>
              <input
                type="checkbox"
                checked={formData.autoDetectHeatmaps}
                onChange={(e) => setFormData({ ...formData, autoDetectHeatmaps: e.target.checked })}
                className="w-5 h-5 accent-[#0B5CFF] rounded cursor-pointer"
              />
            </div>

            {/* Toggle 2: Fatigue Alerts */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-[#061122] border border-[#1B3554]">
              <div>
                <span className="text-xs font-bold text-[#F8FAFC] block">
                  High Fatigue / High Sprint Load Notifications
                </span>
                <span className="text-[11px] text-[#94A3B8]">
                  Notify coaches when a player exceeds 30 sprints or 9.0 km distance threshold.
                </span>
              </div>
              <input
                type="checkbox"
                checked={formData.alertOnHighFatigue}
                onChange={(e) => setFormData({ ...formData, alertOnHighFatigue: e.target.checked })}
                className="w-5 h-5 accent-[#0B5CFF] rounded cursor-pointer"
              />
            </div>
          </div>
        </form>
      )}
    </div>
  );
};
