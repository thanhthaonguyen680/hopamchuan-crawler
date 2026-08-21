/**
 * Standalone test script for the ID-range discovery logic.
 *
 * Usage:
 *   npm run discover -- --start 87895 --probe 30 --misses 10
 */
import "dotenv/config";
import { discoverNewSongs } from "./lib/discover.js";

function parseArg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || !process.argv[idx + 1]) return fallback;
  return Number(process.argv[idx + 1]);
}

async function main() {
  const startId = parseArg("start", 87895);
  const maxIdsToProbe = parseArg("probe", 30);
  const maxConsecutiveMisses = parseArg(
    "misses",
    Number(process.env.CRAWL_MAX_CONSECUTIVE_MISSES ?? 40),
  );
  const delayMs = parseArg("delay", Number(process.env.CRAWL_DELAY_MS ?? 1500));

  console.log(
    `Probing IDs from ${startId}, up to ${maxIdsToProbe} IDs, stopping after ${maxConsecutiveMisses} consecutive misses, ${delayMs}ms delay...\n`,
  );

  const found = await discoverNewSongs({
    startId,
    maxIdsToProbe,
    maxConsecutiveMisses,
    delayMs,
    onProgress: ({ id, found: ok, consecutiveMisses }) => {
      console.log(`  id=${id}  ${ok ? "FOUND" : "miss"}  (consecutive misses: ${consecutiveMisses})`);
    },
  });

  console.log(`\nDiscovered ${found.length} song(s):`);
  for (const s of found) {
    console.log(`  [${s.id}] ${s.url}`);
  }
}

main().catch((err) => {
  console.error("discover.ts failed:", err);
  process.exit(1);
});
