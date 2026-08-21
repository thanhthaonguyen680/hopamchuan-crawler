import { GoogleGenAI } from "@google/genai";
import type { ParsedSong } from "./types.js";
import { SYSTEM_PROMPT, extractRelevantSection, sanitizeHtml, extractJson, validate } from "./validate.js";

// Free-tier model as of writing — override via GEMINI_MODEL if needed.
// See https://ai.google.dev/gemini-api/docs/pricing for the current free list.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const MAX_OUTPUT_TOKENS = 16000;
// The free tier has occasionally hung far longer than any real response
// should take — bound each attempt so a stuck call gets abandoned and
// retried instead of eating the whole Vercel function budget (300s, see
// vercel.json) on a single stalled request.
const REQUEST_TIMEOUT_MS = 90000;

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/**
 * Gemini equivalent of parseSongHtml() in claude.ts — same prompt, same
 * shared validate() so both providers are held to an identical output bar.
 *
 * NOTE: on the Gemini free tier, Google may use submitted content to
 * improve their products (unlike the paid tier). Be aware of this before
 * routing production crawl traffic through a free key.
 */
export async function parseSongHtml(
  html: string,
  sourceUrl: string,
  opts: { maxAttempts?: number } = {},
): Promise<ParsedSong> {
  const maxAttempts = opts.maxAttempts ?? 2;
  const cleanedHtml = sanitizeHtml(extractRelevantSection(html));

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const correction =
      attempt > 1
        ? `\n\nLần trước bạn trả về dữ liệu không hợp lệ: ${String(lastError)}. Hãy sửa lại và chỉ trả JSON hợp lệ đúng schema.`
        : "";

    try {
      const interaction = await getClient().interactions.create(
        {
          model: MODEL,
          system_instruction: SYSTEM_PROMPT,
          input: `source_url: ${sourceUrl}${correction}\n\nHTML:\n${cleanedHtml}`,
          generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS },
          // Force JSON-syntax output without pinning to a strict schema dialect
          // (Gemini's schema support has version-specific quirks) — the shared
          // validate() below is the real correctness gate either way.
          response_format: { type: "text", mime_type: "application/json" },
        },
        { timeout: REQUEST_TIMEOUT_MS },
      );

      const text = interaction.output_text;
      if (!text) {
        lastError = new Error("Model response had no output_text");
        continue;
      }

      const raw = extractJson(text);
      return validate(raw, sourceUrl);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`parseSongHtml (gemini) failed after ${maxAttempts} attempts: ${String(lastError)}`);
}
