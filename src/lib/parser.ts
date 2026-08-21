import type { LlmProvider, ParsedSong } from "./types.js";
import { parseSongHtml as parseWithClaude } from "./claude.js";
import { parseSongHtml as parseWithGemini } from "./gemini.js";

export function getConfiguredProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER || "claude").toLowerCase();
  if (raw !== "claude" && raw !== "gemini") {
    throw new Error(`Unknown LLM_PROVIDER "${raw}" — expected "claude" or "gemini"`);
  }
  return raw;
}

/**
 * Parse a song page's HTML through whichever provider is configured
 * (LLM_PROVIDER env var, default "claude"). Returns which provider actually
 * served the request alongside the result, so callers (crawl_log) can
 * record it.
 */
export async function parseSong(
  html: string,
  sourceUrl: string,
  opts: { provider?: LlmProvider; maxAttempts?: number } = {},
): Promise<{ song: ParsedSong; provider: LlmProvider }> {
  const provider = opts.provider ?? getConfiguredProvider();

  const song =
    provider === "gemini"
      ? await parseWithGemini(html, sourceUrl, { maxAttempts: opts.maxAttempts })
      : await parseWithClaude(html, sourceUrl, { maxAttempts: opts.maxAttempts });

  return { song, provider };
}
