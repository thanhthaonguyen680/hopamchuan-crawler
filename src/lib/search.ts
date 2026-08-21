import { fetchHtml } from "./http.js";

const BASE = "https://hopamchuan.com";

export interface SearchResult {
  id: number;
  title: string;
  artist: string | null;
  url: string;
}

/**
 * Search hopamchuan.com's own search endpoint (https://hopamchuan.com/search?q=...)
 * and extract clean {id, title, artist, url} results — this is a plain
 * server-side HTML fetch, never rendered in a browser, so none of the
 * site's ads are ever seen by whoever calls this.
 */
export async function searchSongs(query: string): Promise<SearchResult[]> {
  const url = `${BASE}/search?q=${encodeURIComponent(query)}`;
  const result = await fetchHtml(url);
  if (!result.ok) {
    throw new Error(`Search request failed: HTTP ${result.status}`);
  }

  const blockRe = /<div class="song-title-singers">([\s\S]*?)<\/div>/g;
  const titleRe = /<a href="https:\/\/hopamchuan\.com\/song\/(\d+)\/([^"?]*)[^"]*"\s+class="song-title">\s*([^<]+?)\s*<\/a>/;
  const artistRe = /class="author-item">\s*([^<]+?)\s*<\/a>/;

  const results: SearchResult[] = [];
  for (const block of result.html.matchAll(blockRe)) {
    const titleMatch = block[1].match(titleRe);
    if (!titleMatch) continue;
    const artistMatch = block[1].match(artistRe);

    const id = Number(titleMatch[1]);
    const slug = titleMatch[2].replace(/\/$/, "");
    results.push({
      id,
      title: titleMatch[3],
      artist: artistMatch ? artistMatch[1] : null,
      url: `${BASE}/song/${id}/${slug}/`,
    });
  }

  return results;
}
