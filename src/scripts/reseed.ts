/**
 * Re-seed the database from the CSV file.
 *
 * Clears all snapshots, alerts, and safes, then re-imports addresses from CSV.
 * Run via: npm run db:reseed
 * Or inside Docker: docker compose exec backend node dist/scripts/reseed.js
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { loadSafesFromCsv } from "../services/safe-discovery.js";
import { config } from "../config.js";

async function reseed() {
  const csvPath = config.safes.csvPath;
  console.log("Clearing database tables...");

  // Delete in order: snapshots & alerts (FK refs) → safes
  await db.execute(sql`DELETE FROM safe_snapshots`);
  await db.execute(sql`DELETE FROM alerts`);
  await db.execute(sql`DELETE FROM user_safes`);

  console.log("Tables cleared. Loading CSV:", csvPath);
  const count = await loadSafesFromCsv(csvPath);
  console.log(`Done. Loaded ${count} addresses from CSV.`);

  process.exit(0);
}

reseed().catch((err) => {
  console.error("Reseed failed:", err);
  process.exit(1);
});
