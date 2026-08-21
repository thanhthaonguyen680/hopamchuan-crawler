export interface LyricLine {
  line: string;
}

export interface ParsedSong {
  source_url: string;
  title: string;
  artist: string | null;
  composer: string | null;
  key: string | null;
  capo: number | null;
  tempo: string | null;
  genre: string | null;
  lyrics_with_chords: LyricLine[];
  chords_used: string[];
  view_count: number | null;
  published_date: string | null; // YYYY-MM-DD
  crawled_at: string; // ISO timestamp
}

export type LlmProvider = "claude" | "gemini";
