import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth, layout, renderSongDetail } from "../../src/lib/render.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return;

  const idParam = req.query.id;
  const sourceId = Number(Array.isArray(idParam) ? idParam[0] : idParam);
  if (!Number.isFinite(sourceId)) {
    res.status(400).send(layout("Bad request", "<p>ID không hợp lệ.</p>"));
    return;
  }

  const html = await renderSongDetail(sourceId);
  if (!html) {
    res.status(404).send(layout("Not found", "<p>Không tìm thấy bài hát này.</p>"));
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
