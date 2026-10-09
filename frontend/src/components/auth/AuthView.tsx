'use client';

import React, { useState } from 'react';
import {
  Lock,
  Mail,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Video,
  Activity,
  Cpu,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export const AuthView: React.FC = () => {
  const { signIn, signUp, authError, clearError } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleTabChange = (newMode: 'signin' | 'signup') => {
    setMode(newMode);
    setValidationError(null);
    setInfoMessage(null);
    clearError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setInfoMessage(null);
    clearError();

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setValidationError('Please enter your email address.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setValidationError('Please enter a valid email address.');
      return;
    }

    if (!password) {
      setValidationError('Please enter a password.');
      return;
    }

    if (password.length < 6) {
      setValidationError('Password must be at least 6 characters.');
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setValidationError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    if (mode === 'signin') {
      const res = await signIn(cleanEmail, password);
      setIsSubmitting(false);
      if (!res.success && res.error) {
        // error already set in auth context
      }
    } else {
      const res = await signUp(cleanEmail, password);
      setIsSubmitting(false);
      if (res.success) {
        if (res.requiresEmailConfirmation) {
          setInfoMessage(
            'Account created! A confirmation link was sent to your email. Please check your inbox to verify before signing in.'
          );
        } else {
          setInfoMessage('Account created successfully! Logging you in...');
        }
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F4EE] flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8 antialiased selection:bg-[#262626] selection:text-white">
      {/* Brand Header */}
      <div className="w-full max-w-md text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#262626] border border-[#D9D3C5] shadow-sm mb-4">
          <svg
            className="w-8 h-8 text-[#F9F7F2]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m4.93 4.93 4.24 4.24" />
            <path d="m14.83 9.17 4.24-4.24" />
            <path d="m14.83 14.83 4.24 4.24" />
            <path d="m9.17 14.83-4.24 4.24" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-[#242424] tracking-tight">
          FootballCoach <span className="text-[#262626]">PRO</span>
        </h1>
        <p className="text-xs sm:text-sm text-[#858585] mt-1 font-medium">
          Tactical Video Analytics & Computer Vision Platform
        </p>
      </div>

      {/* Auth Card */}
      <div className="w-full max-w-md bg-[#FAF8F4] border border-[#E8E3D8] rounded-3xl p-6 sm:p-8 shadow-sm">
        {/* Toggle Pill Buttons */}
        <div className="flex rounded-xl bg-[#EEEBE3] p-1 mb-6 border border-[#E8E3D8]">
          <button
            type="button"
            onClick={() => handleTabChange('signin')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              mode === 'signin'
                ? 'bg-[#262626] text-white shadow-sm'
                : 'text-[#555555] hover:text-[#242424]'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('signup')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              mode === 'signup'
                ? 'bg-[#262626] text-white shadow-sm'
                : 'text-[#555555] hover:text-[#242424]'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Informational Banner */}
        {infoMessage && (
          <div className="mb-5 p-3.5 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] flex items-start gap-2.5 text-xs text-[#166534]">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#16A34A] mt-0.5" />
            <span className="leading-relaxed font-medium">{infoMessage}</span>
          </div>
        )}

        {/* Error Alert */}
        {(validationError || authError) && (
          <div className="mb-5 p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] flex items-start gap-2.5 text-xs text-[#991B1B]">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#DC2626] mt-0.5" />
            <span className="leading-relaxed font-medium">
              {validationError || authError}
            </span>
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#242424] mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#858585] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="coach@footballclub.com"
                autoComplete="email"
                required
                className="w-full pl-10 pr-3.5 py-2.5 text-xs rounded-xl bg-[#FBFAF7] border border-[#E8E3D8] text-[#242424] placeholder-[#858585] focus:outline-none focus:border-[#262626] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#242424] mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#858585] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                className="w-full pl-10 pr-10 py-2.5 text-xs rounded-xl bg-[#FBFAF7] border border-[#E8E3D8] text-[#242424] placeholder-[#858585] focus:outline-none focus:border-[#262626] transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#858585] hover:text-[#242424] transition-colors p-1"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            {mode === 'signup' && (
              <span className="text-[10px] text-[#858585] mt-1 block">
                Must be at least 6 characters
              </span>
            )}
          </div>

          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-bold text-[#242424] mb-1.5">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#858585] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                  className="w-full pl-10 pr-3.5 py-2.5 text-xs rounded-xl bg-[#FBFAF7] border border-[#E8E3D8] text-[#242424] placeholder-[#858585] focus:outline-none focus:border-[#262626] transition-colors"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-[#262626] hover:bg-[#171717] disabled:bg-[#858585] text-white text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-2 group cursor-pointer"
          >
            {isSubmitting ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>{mode === 'signin' ? 'Sign In' : 'Create Account'}</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </>
            )}
          </button>
        </form>

        {/* Security badge note */}
        <div className="mt-6 pt-4 border-t border-[#E8E3D8] flex items-center justify-center gap-2 text-[11px] text-[#858585]">
          <ShieldCheck className="w-3.5 h-3.5 text-[#16A34A]" />
          <span>Secured with Supabase Authentication & RLS</span>
        </div>
      </div>

      {/* Feature Highlights Footer */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full text-center">
        <div className="p-3 rounded-2xl bg-[#FAF8F4]/70 border border-[#E8E3D8] flex flex-col items-center">
          <Video className="w-4 h-4 text-[#262626] mb-1.5" />
          <span className="text-xs font-bold text-[#242424]">Private Storage</span>
          <span className="text-[10px] text-[#858585] mt-0.5">
            Encrypted match video storage with signed URL playback
          </span>
        </div>
        <div className="p-3 rounded-2xl bg-[#FAF8F4]/70 border border-[#E8E3D8] flex flex-col items-center">
          <Cpu className="w-4 h-4 text-[#262626] mb-1.5" />
          <span className="text-xs font-bold text-[#242424]">YOLO Analytics</span>
          <span className="text-[10px] text-[#858585] mt-0.5">
            Automatic player, ball, goal, and sprint detection
          </span>
        </div>
        <div className="p-3 rounded-2xl bg-[#FAF8F4]/70 border border-[#E8E3D8] flex flex-col items-center">
          <Activity className="w-4 h-4 text-[#262626] mb-1.5" />
          <span className="text-xs font-bold text-[#242424]">Isolated Sessions</span>
          <span className="text-[10px] text-[#858585] mt-0.5">
            Row Level Security guarantees complete data privacy
          </span>
        </div>
      </div>
    </div>
  );
};
