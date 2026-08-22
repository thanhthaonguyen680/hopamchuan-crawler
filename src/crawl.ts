/**
 * Master crawl script:
 *   1. Read the highest known source_id from `songs` (the DB "diff" point).
 *   2. Probe subsequent IDs on hopamchuan.com to discover new songs
 *      (discovery already fetches the full HTML — no separate fetch pass).
 *   3. For each newly discovered song: parse HTML -> JSON via Claude,
 *      validate, upsert into `songs`, and record every step in `crawl_log`.
 *
 * Usage:
 *   npm run crawl                          # normal run, resumes from DB
 *   npm run crawl -- --start 87900         # override the resume point
 *   npm run crawl -- --ids 12345,67890     # crawl specific IDs only (e.g. from `npm run search`)
 *   npm run crawl -- --dry-run             # discover + parse (calls Claude, costs $), skip DB writes
 *   npm run crawl -- --discover-only       # discover + fetch only, NO Claude call, NO DB writes — free
 */
import "dotenv/config";
import { discoverNewSongs, fetchSongsByIds } from "./lib/discover.js";
import { parseSong, getConfiguredProvider } from "./lib/parser.js";
import {
  getMaxKnownSourceId,
  sourceIdExists,
  upsertSong,
  insertCrawlLog,
  newRunId,
  getPool,
} from "./lib/db.js";
import { findUserByUsername } from "./lib/auth.js";

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx === -1 ? undefined : process.argv[idx + 1];
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const discoverOnly = hasFlag("discover-only");
  const dryRun = discoverOnly || hasFlag("dry-run");
  const runId = newRunId();

  // Songs are per-user now — CRAWL_USERNAME picks which account owns
  // whatever this run crawls. Sign up at /signup on the web app first.
  const crawlUsername = process.env.CRAWL_USERNAME;
  if (!crawlUsername) {
    console.error("CRAWL_USERNAME not set in .env — sign up an account at /signup on the web app, then set CRAWL_USERNAME to that username.");
    process.exit(1);
  }
  const crawlUser = await findUserByUsername(crawlUsername);
  if (!crawlUser) {
    console.error(`No user named "${crawlUsername}" found — sign up at /signup first, then set CRAWL_USERNAME to match.`);
    process.exit(1);
  }
  const userId = crawlUser.id;

  const maxIdsToProbe = Number(getArg("probe") ?? process.env.CRAWL_ID_BATCH_SIZE ?? 200);
  const maxConsecutiveMisses = Number(
    getArg("misses") ?? process.env.CRAWL_MAX_CONSECUTIVE_MISSES ?? 40,
  );
  const delayMs = Number(getArg("delay") ?? process.env.CRAWL_DELAY_MS ?? 1500);

  // Fail fast on a bad LLM_PROVIDER value before any network calls.
  const provider = discoverOnly ? null : getConfiguredProvider();
  const statusSuffix = discoverOnly
    ? " [DISCOVER ONLY — no LLM calls, no DB writes, free]"
    : dryRun
      ? ` [DRY RUN — calls ${provider} (costs $ unless free tier), no DB writes]`
      : ` [provider: ${provider}]`;

  const explicitIds = getArg("ids")
    ?.split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));

  let discovered;
  if (explicitIds && explicitIds.length > 0) {
    console.log(`[run ${runId}] crawling ${explicitIds.length} explicit ID(s): ${explicitIds.join(", ")}${statusSuffix}`);
    discovered = await fetchSongsByIds(explicitIds, {
      delayMs,
      onProgress: ({ id, found }) => {
        console.log(`  fetch ${id}: ${found ? "found" : "miss (404)"}`);
      },
    });
  } else {
    const overrideStart = getArg("start");
    const maxKnownId = overrideStart ? Number(overrideStart) - 1 : await getMaxKnownSourceId(userId);
    const startId = maxKnownId + 1;

    console.log(
      `[run ${runId}] resuming from source_id=${startId} (max known: ${maxKnownId}), ` +
        `probing up to ${maxIdsToProbe} IDs, stop after ${maxConsecutiveMisses} consecutive misses${statusSuffix}`,
    );

    discovered = await discoverNewSongs({
      startId,
      maxIdsToProbe,
      maxConsecutiveMisses,
      delayMs,
      onProgress: ({ id, found }) => {
        console.log(`  probe ${id}: ${found ? "found" : "miss"}`);
      },
    });
  }

  console.log(`[run ${runId}] discovered ${discovered.length} candidate song(s)`);

  let parsedOk = 0;
  let parsedFailed = 0;
  let skipped = 0;

  for (const song of discovered) {
    const startedAt = new Date();

    if (!dryRun && (await sourceIdExists(userId, song.id))) {
      skipped++;
      await insertCrawlLog({
        runId,
        sourceId: song.id,
        sourceUrl: song.url,
        status: "skipped",
        startedAt,
        finishedAt: new Date(),
      });
      console.log(`  [${song.id}] already in DB, skipping`);
      continue;
    }

    if (!dryRun) {
      await insertCrawlLog({
        runId,
        sourceId: song.id,
        sourceUrl: song.url,
        status: "fetch_ok",
        startedAt,
        finishedAt: new Date(),
      });
    }

    if (discoverOnly) {
      console.log(`  [${song.id}] fetched, ${song.html.length} bytes — skipping LLM parse (--discover-only)`);
      continue;
    }

    try {
      const { song: parsed, provider: usedProvider } = await parseSong(song.html, song.url, {
        provider: provider ?? undefined,
      });
      parsedOk++;

      if (!dryRun) {
        await insertCrawlLog({
          runId,
          sourceId: song.id,
          sourceUrl: song.url,
          status: "parse_ok",
          llmProvider: usedProvider,
          startedAt,
          finishedAt: new Date(),
        });
        await upsertSong(userId, song.id, parsed);
        await insertCrawlLog({
          runId,
          sourceId: song.id,
          sourceUrl: song.url,
          status: "upserted",
          llmProvider: usedProvider,
          startedAt,
          finishedAt: new Date(),
        });
      }

      console.log(`  [${song.id}] parsed OK (${usedProvider}): "${parsed.title}"`);
    } catch (err) {
      parsedFailed++;
      console.error(`  [${song.id}] parse FAILED: ${String(err)}`);

      if (!dryRun) {
        await insertCrawlLog({
          runId,
          sourceId: song.id,
          sourceUrl: song.url,
          status: "parse_failed",
          errorMessage: String(err),
          llmProvider: provider ?? undefined,
          startedAt,
          finishedAt: new Date(),
        });
      }
    }
  }

  console.log(
    `[run ${runId}] done. discovered=${discovered.length} parsed_ok=${parsedOk} ` +
      `parsed_failed=${parsedFailed} skipped=${skipped}`,
  );

  if (!dryRun) await getPool().end();
}

main().catch((err) => {
  console.error("crawl.ts failed:", err);
  process.exit(1);
});
