/**
 * Standalone test script for the HTML -> JSON parsing step.
 * Reads a previously-fetched HTML fixture (see fetchSong.ts) and runs it
 * through the configured LLM provider (LLM_PROVIDER=claude|gemini, default
 * claude), printing the validated result.
 *
 * Usage:
 *   npm run fetch-one -- --id 87901          # produces fixtures/song-87901.html
 *   npm run parse-one -- --id 87901 --url https://hopamchuan.com/song/87901/love-i-you/
 *   LLM_PROVIDER=gemini npm run parse-one -- --id 87901
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseSong, getConfiguredProvider } from "./lib/parser.js";

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

async function main() {
  const id = getArg("id");
  const url = getArg("url") ?? `https://hopamchuan.com/song/${id}/unknown-slug/`;

  if (!id) {
    console.error("Usage: npm run parse-one -- --id 87901 [--url <real song URL>]");
    process.exit(1);
  }

  const provider = getConfiguredProvider();
  const keyVar = provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  if (!process.env[keyVar]) {
    console.error(`${keyVar} is not set. Add it to .env before running this script.`);
    process.exit(1);
  }

  const html = readFileSync(`fixtures/song-${id}.html`, "utf-8");

  console.log(`Parsing fixtures/song-${id}.html with provider="${provider}"...`);
  const { song } = await parseSong(html, url, { provider });

  console.log(JSON.stringify(song, null, 2));
}

main().catch((err) => {
  console.error("parseSong.ts failed:", err);
  process.exit(1);
});
