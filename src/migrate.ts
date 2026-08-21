import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPool } from "./lib/db.js";

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sqlPath = path.join(here, "..", "sql", "schema.sql");
  const sql = readFileSync(sqlPath, "utf-8");

  console.log(`Applying ${sqlPath} to ${maskDbUrl(process.env.DATABASE_URL)}...`);
  await getPool().query(sql);
  console.log("Schema applied successfully.");
  await getPool().end();
}

function maskDbUrl(url: string | undefined): string {
  if (!url) return "(unset)";
  return url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");
}

main().catch((err) => {
  console.error("migrate.ts failed:", err);
  process.exit(1);
});
