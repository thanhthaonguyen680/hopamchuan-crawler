import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth, layout } from "../../../src/lib/render.js";
import { getPool } from "../../../src/lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).send(layout("Method not allowed", "<p>Chỉ chấp nhận POST.</p>"));
    return;
  }

  const idParam = req.query.id;
  const sourceId = Number(Array.isArray(idParam) ? idParam[0] : idParam);
  if (!Number.isFinite(sourceId)) {
    res.status(400).send(layout("Bad request", "<p>ID không hợp lệ.</p>"));
    return;
  }

  await getPool().query("DELETE FROM songs WHERE source_id = $1", [sourceId]);

  res.setHeader("Location", "/");
  res.status(303).end();
}
