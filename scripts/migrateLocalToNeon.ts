/**
 * One-off: copy already-crawled rows from local Postgres to the Neon
 * (Vercel) Postgres, so we don't have to re-spend Gemini free-tier quota
 * re-parsing songs we already have locally.
 *
 * Usage: LOCAL_DATABASE_URL=... NEON_DATABASE_URL=... npx tsx scripts/migrateLocalToNeon.ts
 */
import pg from "pg";

const localUrl = process.env.LOCAL_DATABASE_URL;
const neonUrl = process.env.NEON_DATABASE_URL;
if (!localUrl || !neonUrl) {
  console.error("Set LOCAL_DATABASE_URL and NEON_DATABASE_URL env vars first.");
  process.exit(1);
}

const local = new pg.Pool({ connectionString: localUrl });
const neon = new pg.Pool({ connectionString: neonUrl });

async function main() {
  const { rows } = await local.query("SELECT * FROM songs ORDER BY source_id");
  console.log(`Copying ${rows.length} song(s) from local -> Neon...`);

  for (const s of rows) {
    await neon.query(
      `INSERT INTO songs (
         source_id, source_url, title, artist, composer, "key", capo, tempo,
         genre, lyrics_with_chords, chords_used, view_count, published_date, crawled_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (source_id) DO NOTHING`,
      [
        s.source_id, s.source_url, s.title, s.artist, s.composer, s.key, s.capo,
        s.tempo, s.genre, JSON.stringify(s.lyrics_with_chords), s.chords_used,
        s.view_count, s.published_date, s.crawled_at,
      ],
    );
    console.log(`  copied [${s.source_id}] ${s.title}`);
  }

  await local.end();
  await neon.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
