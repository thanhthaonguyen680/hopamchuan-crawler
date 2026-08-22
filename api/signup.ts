import type { VercelRequest, VercelResponse } from "@vercel/node";
import { renderSignupPage } from "../src/lib/render.js";
import { createUser, findUserByUsername, setSessionCookieHeader } from "../src/lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(renderSignupPage());
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send(renderSignupPage("Method not allowed."));
    return;
  }

  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (username.length < 3 || password.length < 6) {
    res.status(400).send(renderSignupPage("Tên đăng nhập tối thiểu 3 ký tự, mật khẩu tối thiểu 6 ký tự."));
    return;
  }

  if (await findUserByUsername(username)) {
    res.status(409).send(renderSignupPage("Tên đăng nhập đã tồn tại."));
    return;
  }

  const user = await createUser(username, password);
  res.setHeader("Set-Cookie", setSessionCookieHeader(user.id));
  res.setHeader("Location", "/");
  res.status(303).end();
}
