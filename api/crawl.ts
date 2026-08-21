import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth, layout } from "../src/lib/render.js";
import { fetchSongsByIds } from "../src/lib/discover.js";
import { parseSong } from "../src/lib/parser.js";
import { upsertSong, insertCrawlLog, newRunId } from "../src/lib/db.js";

/**
 * "Crawl now" button target, triggered from the search page for a song
 * that isn't in the DB yet. Runs the whole fetch -> parse -> upsert
 * pipeline synchronously in one request — can take a while on a slow LLM
 * response (seconds to a few minutes on the Gemini free tier). If it times
 * out, fall back to `npm run crawl -- --ids <id>` locally (no time limit
 * there) — see vercel.json for the maxDuration budget on this function.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).send(layout("Method not allowed", "<p>Chỉ chấp nhận POST.</p>"));
    return;
  }

  const idRaw = req.body?.id;
  const sourceId = Number(idRaw);
  if (!Number.isFinite(sourceId)) {
    res.status(400).send(layout("Bad request", "<p>ID không hợp lệ.</p>"));
    return;
  }

  const runId = newRunId();
  const startedAt = new Date();

  try {
    const [song] = await fetchSongsByIds([sourceId], { delayMs: 0 });
    if (!song) {
      res.status(404).send(layout("Not found", `<p>Không tìm thấy bài hát ID ${sourceId} trên hopamchuan.com.</p>`));
      return;
    }

    const { song: parsed, provider } = await parseSong(song.html, song.url);
    await upsertSong(sourceId, parsed);
    await insertCrawlLog({
      runId,
      sourceId,
      sourceUrl: song.url,
      status: "upserted",
      llmProvider: provider,
      startedAt,
      finishedAt: new Date(),
    });

    res.setHeader("Location", `/song/${sourceId}`);
    res.status(303).end();
  } catch (err) {
    await insertCrawlLog({
      runId,
      sourceId,
      status: "parse_failed",
      errorMessage: String(err),
      startedAt,
      finishedAt: new Date(),
    });
    res.status(500).send(
      layout(
        "Crawl failed",
        `<a class="back" href="/search?q=">&larr; Quay lại</a>
         <p>Crawl bài ${sourceId} thất bại: ${String(err)}</p>
         <p>Thử lại, hoặc chạy local: <code>npm run crawl -- --ids ${sourceId}</code></p>`,
      ),
    );
  }
}
