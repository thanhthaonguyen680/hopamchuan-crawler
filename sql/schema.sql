-- HopAmChuan crawler schema
-- Three tables: `users` (accounts), `songs` (parsed data, per-user), and
-- `crawl_log` (per-attempt crawl history/status/errors).

-- Self-serve accounts (anyone can /signup and share the link — no shared
-- password). Each user has their own private song collection below.
CREATE TABLE IF NOT EXISTS users (
    id              BIGSERIAL PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS songs (
    id                  BIGSERIAL PRIMARY KEY,

    -- Owner of this crawled copy. Data is per-user, not shared: two users
    -- crawling the same hopamchuan.com song each get their own row.
    user_id             BIGINT REFERENCES users(id) ON DELETE CASCADE,

    -- The numeric ID from hopamchuan.com/song/{source_id}/{slug}/ — this is
    -- what the ID-range discovery script walks. Unique per-user, not
    -- globally (see idx_songs_user_source_id below).
    source_id           INTEGER NOT NULL,
    source_url          TEXT NOT NULL,

    title               TEXT NOT NULL,
    artist              TEXT,
    composer            TEXT,
    key                 TEXT,
    capo                INTEGER,
    tempo               TEXT,
    genre               TEXT,

    -- Array of {"line": "..."} objects, chords kept inline as [C], [Am], etc.
    lyrics_with_chords  JSONB NOT NULL DEFAULT '[]'::jsonb,
    chords_used         TEXT[] NOT NULL DEFAULT '{}',

    view_count          INTEGER,
    published_date      DATE,

    crawled_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_songs_source_id ON songs (source_id);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs (artist);
CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs (genre);
CREATE INDEX IF NOT EXISTS idx_songs_crawled_at ON songs (crawled_at);

-- Keep updated_at current on every row update.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_songs_updated_at ON songs;
CREATE TRIGGER trg_songs_updated_at
    BEFORE UPDATE ON songs
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


CREATE TABLE IF NOT EXISTS crawl_log (
    id              BIGSERIAL PRIMARY KEY,

    -- Groups every row produced by a single crawl invocation (one UUID per
    -- run of the master script / one n8n execution).
    run_id          UUID NOT NULL,

    source_id       INTEGER,
    source_url      TEXT,

    -- discovered   : URL found by the ID-range probe, not yet processed
    -- fetch_failed : HTML fetch errored out (network/timeout/5xx after retries)
    -- fetch_ok     : HTML fetched successfully
    -- parse_failed : Claude parse/validation failed
    -- parse_ok     : Claude parse succeeded
    -- upserted     : row written to `songs`
    -- skipped      : deliberately not processed (e.g. already in DB)
    status          TEXT NOT NULL CHECK (
                        status IN (
                            'discovered', 'fetch_failed', 'fetch_ok',
                            'parse_failed', 'parse_ok', 'upserted', 'skipped'
                        )
                    ),

    http_status     INTEGER,
    error_message   TEXT,

    -- Which LLM parsed (or attempted to parse) this song: 'claude' or 'gemini'.
    -- NULL for rows that never reach the parse step (e.g. 'discovered', 'skipped').
    llm_provider    TEXT CHECK (llm_provider IN ('claude', 'gemini')),

    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    duration_ms     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_crawl_log_run_id ON crawl_log (run_id);
CREATE INDEX IF NOT EXISTS idx_crawl_log_source_id ON crawl_log (source_id);
CREATE INDEX IF NOT EXISTS idx_crawl_log_status ON crawl_log (status);
CREATE INDEX IF NOT EXISTS idx_crawl_log_started_at ON crawl_log (started_at);


-- Migration for DBs created before `songs` was per-user: add the column and
-- swap the old global-unique constraints for per-user ones. No-op on a
-- fresh install (column/indexes already exist from the CREATE TABLE above).
ALTER TABLE songs ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE songs DROP CONSTRAINT IF EXISTS songs_source_id_key;
ALTER TABLE songs DROP CONSTRAINT IF EXISTS songs_source_url_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_user_source_id ON songs (user_id, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_user_source_url ON songs (user_id, source_url);
