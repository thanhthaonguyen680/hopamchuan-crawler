/**
 * Search hopamchuan.com by name — no ads, no browser, just clean results
 * printed to terminal. Use this to hand-pick specific songs to crawl
 * instead of relying only on sequential ID discovery.
 *
 * Usage:
 *   npm run search -- "hẹn gặp lại"
 */
import "dotenv/config";
import { searchSongs } from "./lib/search.js";

async function main() {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.error('Usage: npm run search -- "tên bài hát"');
    process.exit(1);
  }

  console.log(`Searching hopamchuan.com for "${query}"...\n`);
  const results = await searchSongs(query);

  if (results.length === 0) {
    console.log("Không tìm thấy bài nào.");
    return;
  }

  for (const r of results) {
    console.log(`[${r.id}] ${r.title}${r.artist ? ` — ${r.artist}` : ""}`);
    console.log(`      ${r.url}`);
  }

  console.log(`\n${results.length} kết quả. Để crawl 1 bài cụ thể: npm run crawl -- --ids ${results[0].id}`);
}

main().catch((err) => {
  console.error("search.ts failed:", err);
  process.exit(1);
});
