import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://eibkaoyypiadqbgzhluu.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_50Eoyub1bnDH9NI8nuXoMQ_DYTxc_V4';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase URL or public/anon key is missing. Verify your .env.local file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const STORAGE_BUCKET_NAME = 'football-videos';

export interface DatabaseSession {
  id: string;
  user_id: string;
  title: string;
  video_path: string;
  original_file_name: string | null;
  video_duration_seconds: number | null;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
  total_goals: number;
  total_shots: number;
  total_passes: number;
  total_sprints: number;
  class_counts: {
    player: number;
    football: number;
    player_with_ball: number;
    football_goal: number;
  };
  analytics: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Generates a short-lived signed URL (default 1 hour = 3600s) for a private video object.
 */
export async function getSignedVideoUrl(
  videoPath: string,
  expiresInSeconds: number = 3600
): Promise<{ signedUrl: string | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET_NAME)
      .createSignedUrl(videoPath, expiresInSeconds);

    if (error) {
      return { signedUrl: null, error: new Error(error.message) };
    }
    return { signedUrl: data.signedUrl, error: null };
  } catch (err) {
    return {
      signedUrl: null,
      error: err instanceof Error ? err : new Error('Failed to create signed URL'),
    };
  }
}

/**
 * Removes the video file from Supabase Storage.
 */
export async function removeStorageVideo(
  videoPath: string
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET_NAME)
      .remove([videoPath]);

    if (error) {
      return { success: false, error: new Error(error.message) };
    }
    return { success: true, error: null };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error('Failed to delete video file'),
    };
  }
}
