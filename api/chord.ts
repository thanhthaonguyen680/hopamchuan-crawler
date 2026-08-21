import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../src/lib/render.js";
import { renderChordSvg } from "../src/lib/chords.js";

/** Returns the SVG fretboard diagram for a given chord name (?name=D). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return;

  const name = typeof req.query.name === "string" ? req.query.name : "";
  if (!name) {
    res.status(400).send("Missing ?name=");
    return;
  }

  res.setHeader("Content-Type", "image/svg+xml");
  res.status(200).send(renderChordSvg(name));
}
