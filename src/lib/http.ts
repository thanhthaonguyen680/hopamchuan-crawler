const DEFAULT_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS ?? 15000);
const DEFAULT_MAX_RETRIES = Number(process.env.HTTP_MAX_RETRIES ?? 3);
const USER_AGENT =
  "Mozilla/5.0 (compatible; HopAmChuanCrawler/1.0; +internal-research-tool)";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchResult {
  ok: boolean;
  status: number;
  html: string;
  finalUrl: string;
}

/**
 * GET a URL with a timeout and exponential-backoff retries.
 * Retries on network errors, timeouts, and 5xx/429 — never on 4xx (except 429).
 */
export async function fetchHtml(
  url: string,
  opts: { timeoutMs?: number; maxRetries?: number } = {},
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timer);

      // 404 is a definitive, non-retryable "does not exist" — return immediately.
      if (res.status === 404) {
        return { ok: false, status: 404, html: "", finalUrl: res.url };
      }

      // Retry on server errors / rate limiting.
      if (res.status >= 500 || res.status === 429) {
        lastError = new Error(`HTTP ${res.status} from ${url}`);
        await backoff(attempt);
        continue;
      }

      if (!res.ok) {
        // Other 4xx: not retryable, but not a "not found" either.
        return { ok: false, status: res.status, html: "", finalUrl: res.url };
      }

      const html = await res.text();
      return { ok: true, status: res.status, html, finalUrl: res.url };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      await backoff(attempt);
    }
  }

  throw new Error(
    `fetchHtml failed after ${maxRetries + 1} attempts for ${url}: ${String(lastError)}`,
  );
}

async function backoff(attempt: number): Promise<void> {
  const base = 500 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  await sleep(base + jitter);
}
