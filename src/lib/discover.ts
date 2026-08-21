import { fetchHtml, sleep } from "./http.js";

const BASE = "https://hopamchuan.com";
const PROBE_SLUG = "x";

export interface DiscoveredSong {
  id: number;
  url: string;
  html: string;
}

/**
 * Probe song IDs sequentially starting at `startId`, following
 * https://hopamchuan.com/song/{id}/{slug}/ — the slug does not need to be
 * correct; the server resolves purely on the numeric ID. We use a
 * placeholder slug and recover the real one from elsewhere in the response.
 *
 * Stops once `maxConsecutiveMisses` 404s in a row are seen (song IDs are
 * dense but not perfectly contiguous — some are deleted/hidden), or once
 * `maxIdsToProbe` IDs have been checked, whichever comes first.
 */
export async function discoverNewSongs(opts: {
  startId: number;
  maxIdsToProbe: number;
  maxConsecutiveMisses: number;
  delayMs: number;
  onProgress?: (info: { id: number; found: boolean; consecutiveMisses: number }) => void;
}): Promise<DiscoveredSong[]> {
  const { startId, maxIdsToProbe, maxConsecutiveMisses, delayMs, onProgress } = opts;

  const found: DiscoveredSong[] = [];
  let consecutiveMisses = 0;

  for (let offset = 0; offset < maxIdsToProbe; offset++) {
    const id = startId + offset;
    const song = await fetchSongById(id);

    if (song) {
      consecutiveMisses = 0;
      found.push(song);
    } else {
      consecutiveMisses++;
    }

    onProgress?.({ id, found: song !== null, consecutiveMisses });

    if (consecutiveMisses >= maxConsecutiveMisses) {
      break;
    }

    await sleep(delayMs);
  }

  return found;
}

/**
 * Fetch a specific, already-known set of song IDs (e.g. hand-picked via
 * searchSongs()) rather than probing a sequential range. IDs that 404 are
 * silently dropped from the result.
 */
export async function fetchSongsByIds(
  ids: number[],
  opts: { delayMs: number; onProgress?: (info: { id: number; found: boolean }) => void },
): Promise<DiscoveredSong[]> {
  const found: DiscoveredSong[] = [];

  for (const id of ids) {
    const song = await fetchSongById(id);
    if (song) found.push(song);
    opts.onProgress?.({ id, found: song !== null });
    await sleep(opts.delayMs);
  }

  return found;
}

async function fetchSongById(id: number): Promise<DiscoveredSong | null> {
  const probeUrl = `${BASE}/song/${id}/${PROBE_SLUG}/`;
  const result = await fetchHtml(probeUrl);
  if (!result.ok) return null;

  const realUrl = extractRealSongUrl(result.html, id) ?? result.finalUrl;
  return { id, url: realUrl, html: result.html };
}

/**
 * The canonical/og:url meta tags just echo back whatever slug was requested
 * (our placeholder probe slug), so they can't be trusted for the real slug.
 * The real slug also appears verbatim elsewhere on the page — in a share
 * link, the JSON-LD block, etc. — so scan for every self-referencing
 * /song/{id}/{slug} occurrence and return the first one that isn't our
 * placeholder.
 */
function extractRealSongUrl(html: string, id: number): string | null {
  const pattern = new RegExp(`https?://hopamchuan\\.com/song/${id}/([a-z0-9-]+)`, "gi");
  for (const match of html.matchAll(pattern)) {
    const slug = match[1];
    if (slug !== PROBE_SLUG) {
      return `https://hopamchuan.com/song/${id}/${slug}/`;
    }
  }
  return null;
}
