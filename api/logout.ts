import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearSessionCookieHeader } from "../src/lib/auth.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Set-Cookie", clearSessionCookieHeader());
  res.setHeader("Location", "/login");
  res.status(303).end();
}
