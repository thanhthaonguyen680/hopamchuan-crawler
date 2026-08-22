/**
 * Multi-user auth for the public viewer (api/*.ts): anyone can /signup with
 * their own username/password, so the link can be shared without handing
 * out one shared credential. Every account sees the same `songs` table —
 * accounts only gate who can log in, they don't partition data.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { getPool } from "./db.js";

export interface User {
  id: number;
  username: string;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPasswordHash(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export async function findUserByUsername(
  username: string,
): Promise<{ id: number; username: string; password_hash: string } | null> {
  const { rows } = await getPool().query<{ id: number; username: string; password_hash: string }>(
    "SELECT id, username, password_hash FROM users WHERE username = $1",
    [username],
  );
  return rows[0] ?? null;
}

export async function createUser(username: string, password: string): Promise<User> {
  const { rows } = await getPool().query<User>(
    "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
    [username, hashPassword(password)],
  );
  return rows[0];
}

export async function verifyLogin(username: string, password: string): Promise<User | null> {
  const user = await findUserByUsername(username);
  if (!user || !verifyPasswordHash(password, user.password_hash)) return null;
  return { id: user.id, username: user.username };
}

/** Cookie-based session: `${userId}.${hmac(userId)}`, signed with SESSION_SECRET. */
const SESSION_COOKIE = "hac_session";

function sign(value: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET || "").update(value).digest("hex");
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function getSessionUserId(cookieHeader: string | undefined): number | null {
  const raw = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!raw) return null;

  const dot = raw.lastIndexOf(".");
  if (dot === -1) return null;
  const userIdPart = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(userIdPart);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }

  const userId = Number(userIdPart);
  return Number.isFinite(userId) ? userId : null;
}

export function isAuthenticated(cookieHeader: string | undefined): boolean {
  if (!process.env.SESSION_SECRET) return true; // no secret configured — auth disabled
  return getSessionUserId(cookieHeader) !== null;
}

export function setSessionCookieHeader(userId: number): string {
  const value = `${userId}.${sign(String(userId))}`;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Auth gate for api/*.ts handlers. Returns true if the request may proceed;
 * otherwise it has already written a 303 redirect to /login and the caller
 * must `return` immediately. Uses only ServerResponse-level methods so it
 * works with both VercelResponse and a plain Node http.ServerResponse.
 */
export function requireAuth(
  req: { headers: { cookie?: string } },
  res: { setHeader: (name: string, value: string) => void; writeHead: (code: number, headers?: Record<string, string>) => void; end: () => void },
): boolean {
  if (isAuthenticated(req.headers.cookie)) return true;
  res.writeHead(303, { Location: "/login" });
  res.end();
  return false;
}
