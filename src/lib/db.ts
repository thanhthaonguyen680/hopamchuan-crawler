import { randomUUID } from "node:crypto";
import pg from "pg";
import type { LlmProvider, ParsedSong } from "./types.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export function newRunId(): string {
  return randomUUID();
}

/** Highest known hopamchuan.com numeric song ID already stored in `songs`. */
export async function getMaxKnownSourceId(): Promise<number> {
  const { rows } = await getPool().query<{ max: number | null }>(
    "SELECT MAX(source_id) AS max FROM songs",
  );
  return rows[0]?.max ?? 0;
}

export async function sourceIdExists(sourceId: number): Promise<boolean> {
  const { rows } = await getPool().query(
    "SELECT 1 FROM songs WHERE source_id = $1 LIMIT 1",
    [sourceId],
  );
  return rows.length > 0;
}

export async function upsertSong(sourceId: number, song: ParsedSong): Promise<void> {
  await getPool().query(
    `INSERT INTO songs (
       source_id, source_url, title, artist, composer, "key", capo, tempo,
       genre, lyrics_with_chords, chords_used, view_count, published_date, crawled_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (source_id) DO UPDATE SET
       source_url = EXCLUDED.source_url,
       title = EXCLUDED.title,
       artist = EXCLUDED.artist,
       composer = EXCLUDED.composer,
       "key" = EXCLUDED."key",
       capo = EXCLUDED.capo,
       tempo = EXCLUDED.tempo,
       genre = EXCLUDED.genre,
       lyrics_with_chords = EXCLUDED.lyrics_with_chords,
       chords_used = EXCLUDED.chords_used,
       view_count = EXCLUDED.view_count,
       published_date = EXCLUDED.published_date,
       crawled_at = EXCLUDED.crawled_at`,
    [
      sourceId,
      song.source_url,
      song.title,
      song.artist,
      song.composer,
      song.key,
      song.capo,
      song.tempo,
      song.genre,
      JSON.stringify(song.lyrics_with_chords),
      song.chords_used,
      song.view_count,
      song.published_date,
      song.crawled_at,
    ],
  );
}

export interface CrawlLogEntry {
  runId: string;
  sourceId?: number;
  sourceUrl?: string;
  status:
    | "discovered"
    | "fetch_failed"
    | "fetch_ok"
    | "parse_failed"
    | "parse_ok"
    | "upserted"
    | "skipped";
  httpStatus?: number;
  errorMessage?: string;
  /** Which LLM produced (or attempted) this step — omit for pre-parse statuses. */
  llmProvider?: LlmProvider;
  startedAt: Date;
  finishedAt?: Date;
}

export async function insertCrawlLog(entry: CrawlLogEntry): Promise<void> {
  const durationMs = entry.finishedAt
    ? entry.finishedAt.getTime() - entry.startedAt.getTime()
    : null;

  await getPool().query(
    `INSERT INTO crawl_log (
       run_id, source_id, source_url, status, http_status, error_message,
       llm_provider, started_at, finished_at, duration_ms
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      entry.runId,
      entry.sourceId ?? null,
      entry.sourceUrl ?? null,
      entry.status,
      entry.httpStatus ?? null,
      entry.errorMessage ?? null,
      entry.llmProvider ?? null,
      entry.startedAt,
      entry.finishedAt ?? null,
      durationMs,
    ],
  );
}
