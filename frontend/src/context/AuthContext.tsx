'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  authError: string | null;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (
    email: string,
    password: string
  ) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.warn('Supabase auth session fetch error:', error.message);
        }
        if (mounted) {
          setSession(data.session);
          setUser(data.session?.user ?? null);
          setIsLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (mounted) {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const formatAuthError = (error: AuthError | Error): string => {
    const msg = error.message.toLowerCase();
    if (msg.includes('email logins are disabled') || msg.includes('provider is disabled')) {
      return 'Email provider is turned off in Supabase. In your Supabase Dashboard, go to Authentication -> Providers -> Email and turn "Enable Email provider" back ON.';
    }
    if (msg.includes('invalid login credentials') || msg.includes('invalid_grant')) {
      return 'Invalid email or password. Please verify your credentials and try again.';
    }
    if (msg.includes('email not confirmed')) {
      return 'Your email has not been confirmed yet. Please verify your email inbox or confirm the user in your Supabase Auth dashboard.';
    }
    if (msg.includes('user already registered')) {
      return 'An account with this email is already registered. Please sign in instead.';
    }
    if (msg.includes('password should be at least')) {
      return 'Password must be at least 6 characters long.';
    }
    if (
      msg.includes('rate limit') ||
      msg.includes('too many') ||
      msg.includes('over_email_send_rate_limit')
    ) {
      return 'Supabase email rate limit reached (free tier limit: 3-4 signup emails/hour). To fix this instantly: in your Supabase Dashboard, go to Authentication -> Providers -> Email and turn OFF "Confirm email", or add a user manually under Authentication -> Users.';
    }
    return error.message;
  };

  const signIn = async (
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    setAuthError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      const err = 'Email address is required.';
      setAuthError(err);
      return { success: false, error: err };
    }
    if (!password) {
      const err = 'Password is required.';
      setAuthError(err);
      return { success: false, error: err };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        const formatted = formatAuthError(error);
        setAuthError(formatted);
        return { success: false, error: formatted };
      }

      setSession(data.session);
      setUser(data.user);
      return { success: true };
    } catch (err) {
      const formatted = err instanceof Error ? formatAuthError(err) : 'An unexpected error occurred during login.';
      setAuthError(formatted);
      return { success: false, error: formatted };
    }
  };

  const signUp = async (
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    setAuthError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      const err = 'Email address is required.';
      setAuthError(err);
      return { success: false, error: err };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      const err = 'Please enter a valid email address.';
      setAuthError(err);
      return { success: false, error: err };
    }
    if (!password || password.length < 6) {
      const err = 'Password must be at least 6 characters.';
      setAuthError(err);
      return { success: false, error: err };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      });

      if (error) {
        const formatted = formatAuthError(error);
        setAuthError(formatted);
        return { success: false, error: formatted };
      }

      if (data.session) {
        setSession(data.session);
        setUser(data.user);
        return { success: true };
      }

      // If session is not returned directly, attempt instant auto-login
      const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (!loginErr && loginData?.session) {
        setSession(loginData.session);
        setUser(loginData.user);
        return { success: true };
      }

      // If login error occurred due to email confirmation setting in Supabase
      if (loginErr) {
        const formatted = formatAuthError(loginErr);
        setAuthError(formatted);
        return { success: false, error: formatted };
      }

      return { success: true };
    } catch (err) {
      const formatted = err instanceof Error ? formatAuthError(err) : 'An unexpected error occurred during sign up.';
      setAuthError(formatted);
      return { success: false, error: formatted };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Error signing out:', err);
    } finally {
      setUser(null);
      setSession(null);
      setAuthError(null);
    }
  };

  const clearError = () => {
    setAuthError(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        authError,
        signIn,
        signUp,
        signOut,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
