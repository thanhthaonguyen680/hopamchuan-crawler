import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth, renderSongList, renderSearchResults } from "../src/lib/render.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return;

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(q ? await renderSearchResults(q) : await renderSongList());
}
