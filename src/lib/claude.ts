import Anthropic from "@anthropic-ai/sdk";
import type { ParsedSong } from "./types.js";
import { SYSTEM_PROMPT, extractRelevantSection, sanitizeHtml, extractJson, validate } from "./validate.js";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 16000;
const REQUEST_TIMEOUT_MS = 90000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Ask Claude to parse a hopamchuan.com song page's HTML into structured
 * JSON. Retries once with the validation error appended to the prompt if
 * the first response is invalid JSON or fails schema validation.
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
      const response = await getClient().messages.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `source_url: ${sourceUrl}${correction}\n\nHTML:\n${cleanedHtml}`,
            },
          ],
        },
        { timeout: REQUEST_TIMEOUT_MS },
      );

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        lastError = new Error("Model response had no text block");
        continue;
      }

      const raw = extractJson(textBlock.text);
      return validate(raw, sourceUrl);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`parseSongHtml (claude) failed after ${maxAttempts} attempts: ${String(lastError)}`);
}
