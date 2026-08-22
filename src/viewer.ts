/**
 * Local/LAN viewer — plain Node http server for dev use. For public
 * deployment (Vercel), see the api/ directory instead — both share the
 * same rendering logic in src/lib/render.ts.
 *
 * Usage:
 *   npm run viewer
 *   open http://localhost:3000
 */
import "dotenv/config";
import { createServer } from "node:http";
import { isAuthorized, layout, renderSongList, renderSearchResults, renderSongDetail } from "./lib/render.js";
import { findUserByUsername } from "./lib/auth.js";

const PORT = Number(process.env.VIEWER_PORT ?? 3000);

// Songs are per-account now — the local viewer operates on one account's
// data, picked via CRAWL_USERNAME (same account `npm run crawl` writes to).
const viewerUsername = process.env.CRAWL_USERNAME;
if (!viewerUsername) {
  console.error("CRAWL_USERNAME not set in .env — sign up an account at /signup on the web app, then set CRAWL_USERNAME to that username.");
  process.exit(1);
}
const viewerUser = await findUserByUsername(viewerUsername);
if (!viewerUser) {
  console.error(`No user named "${viewerUsername}" found — sign up at /signup first, then set CRAWL_USERNAME to match.`);
  process.exit(1);
}
const userId = viewerUser.id;

const server = createServer(async (req, res) => {
  try {
    if (!isAuthorized(req.headers.authorization)) {
      res.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="HopAmChuan Viewer"',
        "Content-Type": "text/html; charset=utf-8",
      });
      res.end(layout("Unauthorized", "<p>Cần đăng nhập.</p>"));
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await renderSongList(userId));
      return;
    }

    if (url.pathname === "/search") {
      const q = url.searchParams.get("q")?.trim();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(q ? await renderSearchResults(q, userId) : await renderSongList(userId));
      return;
    }

    const match = url.pathname.match(/^\/song\/(\d+)$/);
    if (match) {
      const html = await renderSongDetail(Number(match[1]), userId);
      if (!html) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(layout("Not found", "<p>Không tìm thấy bài hát này.</p>"));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(layout("Not found", "<p>404 — không tìm thấy trang.</p>"));
  } catch (err) {
    console.error("viewer request failed:", err);
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(layout("Error", "<p>Lỗi server, xem log terminal.</p>"));
  }
});

server.listen(PORT, () => {
  console.log(`Viewer running at http://localhost:${PORT}`);
  if (!process.env.VIEWER_PASSWORD) {
    console.log("⚠️  VIEWER_PASSWORD not set — no auth. Fine for local/LAN, NEVER deploy publicly like this.");
  }
});
