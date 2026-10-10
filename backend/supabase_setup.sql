-- ==============================================================================
-- SUPABASE BACKEND SETUP FOR FOOTBALL ANALYTICS
-- ==============================================================================
-- Run this script in the Supabase SQL Editor to configure tables,
-- storage buckets, and Row Level Security (RLS) policies.
-- ==============================================================================

-- 1. Ensure public.sessions table exists and has proper schema
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    title TEXT NOT NULL DEFAULT 'Football Session',
    video_path TEXT NOT NULL,
    original_file_name TEXT,
    video_duration_seconds NUMERIC(10, 2),

    status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded', 'processing', 'completed', 'failed')),

    -- Session metrics
    total_goals INTEGER NOT NULL DEFAULT 0,
    total_shots INTEGER NOT NULL DEFAULT 0,
    total_passes INTEGER NOT NULL DEFAULT 0,
    total_sprints INTEGER NOT NULL DEFAULT 0,

    -- Counts for detected classes
    class_counts JSONB NOT NULL DEFAULT
        '{"player": 0, "football": 0, "player_with_ball": 0, "football_goal": 0}'::JSONB,

    -- Analytics payload
    analytics JSONB NOT NULL DEFAULT '{}'::JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying user sessions in chronological order
CREATE INDEX IF NOT EXISTS idx_sessions_user_created
    ON public.sessions(user_id, created_at DESC);

-- Enable Row Level Security (RLS) on public.sessions
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Drop policy if existing to allow clean reapplying
DO $$
BEGIN
    DROP POLICY IF EXISTS "Users manage own sessions" ON public.sessions;
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

-- Policy: Authenticated users can insert, select, update, and delete only their own sessions
CREATE POLICY "Users manage own sessions"
ON public.sessions
FOR ALL
TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));


-- 2. Create the private 'football-videos' Storage bucket
-- 2GB limit (2147483648 bytes) and supported football video MIME types
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'football-videos',
    'football-videos',
    false, -- MUST be private
    2147483648, -- 2GB file size limit
    ARRAY['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 2147483648,
    allowed_mime_types = ARRAY['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm'];


-- 3. Storage Row Level Security (RLS) Policies on storage.objects
-- Bucket path convention: USER_UUID/SESSION_UUID/filename.mp4
-- (storage.foldername(name))[1] extracts the first path segment (USER_UUID)

-- Drop existing policies if any to prevent conflicts
DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can upload own videos" ON storage.objects;
    DROP POLICY IF EXISTS "Users can read own videos" ON storage.objects;
    DROP POLICY IF EXISTS "Users can delete own videos" ON storage.objects;
    DROP POLICY IF EXISTS "Users can update own videos" ON storage.objects;
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

-- Policy 1: Authenticated users can upload to their own folder in football-videos
CREATE POLICY "Users can upload own videos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'football-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy 2: Authenticated users can read/view their own video objects
CREATE POLICY "Users can read own videos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'football-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy 3: Authenticated users can delete their own video objects
CREATE POLICY "Users can delete own videos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'football-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy 4: Authenticated users can update their own video objects
CREATE POLICY "Users can update own videos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'football-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
    bucket_id = 'football-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
);


-- ==============================================================================
-- 4. Remove Email Confirmation Requirement & Auto-Confirm All Users
-- ==============================================================================
-- Running this removes email sending dependencies and bypasses Supabase mailer rate limits.

-- A) Auto-confirm any existing unconfirmed users
UPDATE auth.users
SET email_confirmed_at = NOW(), confirmed_at = NOW()
WHERE email_confirmed_at IS NULL;

-- B) Trigger to automatically confirm any newly registered user instantly
CREATE OR REPLACE FUNCTION public.auto_confirm_new_user()
RETURNS TRIGGER AS $$
BEGIN
    NEW.email_confirmed_at = COALESCE(NEW.email_confirmed_at, NOW());
    NEW.confirmed_at = COALESCE(NEW.confirmed_at, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_auto_confirm ON auth.users;
CREATE TRIGGER on_auth_user_created_auto_confirm
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.auto_confirm_new_user();

