import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

/**
 * Ensure the target database exists, creating it if necessary.
 */
async function ensureDatabase(): Promise<void> {
  const url = new URL(config.db.url);
  const dbName = url.pathname.slice(1); // strip leading "/"

  // Connect to the default "postgres" database to check/create
  url.pathname = "/postgres";
  const adminClient = postgres(url.toString(), { max: 1 });

  try {
    const result = await adminClient`
      SELECT 1 FROM pg_database WHERE datname = ${dbName}
    `;
    if (result.length === 0) {
      logger.info({ database: dbName }, "Database does not exist — creating");
      await adminClient.unsafe(`CREATE DATABASE "${dbName}"`);
      logger.info({ database: dbName }, "Database created");
    }
  } finally {
    await adminClient.end();
  }
}

/**
 * Ensure the database exists and run all pending Drizzle migrations.
 * Called at server startup so the DB schema is always up-to-date.
 */
export async function runMigrations(): Promise<void> {
  await ensureDatabase();

  const migrationClient = postgres(config.db.url, { max: 1 });
  const migrationDb = drizzle(migrationClient);

  try {
    logger.info("Running database migrations…");
    await migrate(migrationDb, {
      migrationsFolder: join(process.cwd(), "src", "db", "migrations"),
    });
    logger.info("Migrations complete");
  } finally {
    await migrationClient.end();
  }
}
