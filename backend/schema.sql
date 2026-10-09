
-- 1. One uploaded video = one session
CREATE TABLE public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    title TEXT NOT NULL DEFAULT 'Football Session',
    video_path TEXT NOT NULL,
    original_file_name TEXT,
    video_duration_seconds NUMERIC(10, 2),

    status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded', 'processing', 'completed', 'failed')),

    -- Overall session statistics
    total_goals INTEGER NOT NULL DEFAULT 0,
    total_shots INTEGER NOT NULL DEFAULT 0,
    total_passes INTEGER NOT NULL DEFAULT 0,
    total_sprints INTEGER NOT NULL DEFAULT 0,

    -- Counts for the four model classes
    class_counts JSONB NOT NULL DEFAULT
        '{"player": 0, "football": 0, "player_with_ball": 0, "football_goal": 0}'::JSONB,

    -- Other calculated analytics
    analytics JSONB NOT NULL DEFAULT '{}'::JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 2. Important events detected in the video
CREATE TABLE public.session_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL
        REFERENCES public.sessions(id) ON DELETE CASCADE,

    -- Examples: goal, shot, pass, sprint, dribble
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,

    -- Position in the video, in seconds
    timestamp_seconds NUMERIC(12, 3) NOT NULL
        CHECK (timestamp_seconds >= 0),

    end_timestamp_seconds NUMERIC(12, 3)
        CHECK (
            end_timestamp_seconds IS NULL
            OR end_timestamp_seconds >= timestamp_seconds
        ),

    confidence NUMERIC(4, 3)
        CHECK (
            confidence IS NULL
            OR confidence BETWEEN 0 AND 1
        ),

    -- Relevant detected classes for this event
    detected_classes JSONB NOT NULL DEFAULT '[]'::JSONB,

    -- Bounding boxes, coordinates, goal outcome, etc.
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,

    source TEXT NOT NULL DEFAULT 'ai'
        CHECK (source IN ('ai', 'manual', 'corrected')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 3. Performance indexes
CREATE INDEX idx_sessions_user_created
    ON public.sessions(user_id, created_at DESC);

CREATE INDEX idx_session_events_timeline
    ON public.session_events(session_id, timestamp_seconds);

CREATE INDEX idx_session_events_type
    ON public.session_events(session_id, event_type);


-- 4. Enable Row Level Security
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_events ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Users manage own sessions"
ON public.sessions
FOR ALL
TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));


CREATE POLICY "Users manage events in own sessions"
ON public.session_events
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = session_events.session_id
          AND s.user_id = (SELECT auth.uid())
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = session_events.session_id
          AND s.user_id = (SELECT auth.uid())
    )
);




-- Generic statistics for each football session
CREATE TABLE public.session_statistics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    session_id UUID NOT NULL UNIQUE
        REFERENCES public.sessions(id) ON DELETE CASCADE,

    -- Store any number of statistics as key-value pairs
    stats JSONB NOT NULL DEFAULT '{
        "goals": 0,
        "shots": 0,
        "shots_on_target": 0,
        "shots_off_target": 0,
        "missed_shots": 0,
        "passes": 0,
        "successful_passes": 0,
        "failed_passes": 0,
        "dribbles": 0,
        "sprints": 0,
        "saves": 0,
        "interceptions": 0,
        "tackles": 0,
        "fouls": 0,
        "offsides": 0,
        "possession_percentage": 0
    }'::JSONB,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_session_statistics_session
    ON public.session_statistics(session_id);

LTER TABLE public.session_statistics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage statistics in own sessions"
ON public.session_statistics
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = session_statistics.session_id
          AND s.user_id = (SELECT auth.uid())
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = session_statistics.session_id
          AND s.user_id = (SELECT auth.uid())
    )
);