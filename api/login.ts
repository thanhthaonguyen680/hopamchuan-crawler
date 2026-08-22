import type { VercelRequest, VercelResponse } from "@vercel/node";
import { renderLoginPage } from "../src/lib/render.js";
import { verifyLogin, setSessionCookieHeader } from "../src/lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(renderLoginPage());
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send(renderLoginPage("Method not allowed."));
    return;
  }

  const username = String(req.body?.username ?? "");
  const password = String(req.body?.password ?? "");

  const user = await verifyLogin(username, password);
  if (!user) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(401).send(renderLoginPage("Sai tên đăng nhập hoặc mật khẩu."));
    return;
  }

  res.setHeader("Set-Cookie", setSessionCookieHeader(user.id));
  res.setHeader("Location", "/");
  res.status(303).end();
}
