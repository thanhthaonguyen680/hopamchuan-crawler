/**
 * Standalone test script for fetching a single song page.
 *
 * Usage:
 *   npm run fetch-one -- --id 87901
 *   npm run fetch-one -- --url https://hopamchuan.com/song/87901/love-i-you/
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { fetchHtml } from "./lib/http.js";

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

async function main() {
  const idArg = getArg("id");
  const urlArg = getArg("url");

  const url =
    urlArg ?? (idArg ? `https://hopamchuan.com/song/${idArg}/x/` : undefined);

  if (!url) {
    console.error("Usage: npm run fetch-one -- --id 87901   (or --url <full song URL>)");
    process.exit(1);
  }

  console.log(`Fetching ${url} ...`);
  const result = await fetchHtml(url);

  if (!result.ok) {
    console.error(`Fetch failed: HTTP ${result.status}`);
    process.exit(1);
  }

  console.log(`OK — ${result.html.length} bytes, final URL: ${result.finalUrl}`);

  mkdirSync("fixtures", { recursive: true });
  const outPath = `fixtures/song-${idArg ?? "manual"}.html`;
  writeFileSync(outPath, result.html, "utf-8");
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error("fetchSong.ts failed:", err);
  process.exit(1);
});
