import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth, getSessionUserId, renderSongList } from "../src/lib/render.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(await renderSongList(getSessionUserId(req.headers.cookie)!));
}
