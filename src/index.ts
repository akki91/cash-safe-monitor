/**
 * Main entry point for the Cash Safe LTV Health Monitor.
 *
 * Startup sequence:
 *   1. Connect to the database (Drizzle + postgres.js)
 *   2. Load safe addresses from CSV
 *   3. Start the BullMQ poll worker and schedule recurring polls
 *   4. Start the Fastify API server
 *   5. Register graceful shutdown handlers
 */

import { db } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./utils/logger.js";
import { config } from "./config.js";
import { loadSafesFromCsv } from "./services/safe-discovery.js";
import { startPollWorker, stopPollWorker } from "./workers/poll-worker.js";
import { scheduleRecurringPoll, healthPollQueue } from "./workers/poll-queue.js";
import { startServer } from "./api/server.js";
import { startSystemStatsLogger, stopSystemStatsLogger } from "./utils/system-stats.js";
import { sql } from "drizzle-orm";

async function main() {
  logger.info("Starting Cash Safe LTV Health Monitor");

  // -----------------------------------------------------------------------
  // 1. Ensure database exists, run migrations, verify connectivity
  // -----------------------------------------------------------------------
  try {
    await runMigrations();

    await db.execute(sql`SELECT 1`);
    logger.info("Database connection established");
  } catch (error) {
    logger.fatal(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to connect to database — exiting",
    );
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // 2. Load safe addresses from CSV
  // -----------------------------------------------------------------------
  try {
    const count = await loadSafesFromCsv(config.safes.csvPath);
    logger.info({ totalLoaded: count }, "Safe address loading complete");
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to load safes from CSV — continuing with existing safes in DB",
    );
  }

  // -----------------------------------------------------------------------
  // 3. Start BullMQ poll worker and schedule recurring polls
  // -----------------------------------------------------------------------
  try {
    startPollWorker();
    await scheduleRecurringPoll();
    logger.info(
      { intervalMs: config.polling.intervalMs },
      "Health poll schedule registered",
    );
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to start poll worker — health polling disabled",
    );
  }

  // -----------------------------------------------------------------------
  // 4. Start Fastify API server
  // -----------------------------------------------------------------------
  let app: Awaited<ReturnType<typeof startServer>> | null = null;
  try {
    app = await startServer();
    startSystemStatsLogger();
  } catch (error) {
    logger.fatal(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to start API server — exiting",
    );
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // 5. Graceful shutdown
  // -----------------------------------------------------------------------
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal");

    // Stop system stats logger
    stopSystemStatsLogger();

    // Stop accepting new requests
    if (app) {
      await app.close();
      logger.info("API server closed");
    }

    // Stop workers
    await stopPollWorker();

    // Close queue
    try {
      await healthPollQueue.close();
      logger.info("Queue connection closed");
    } catch {
      // Ignore — connection may already be closing
    }

    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Handle uncaught exceptions and unhandled rejections
  process.on("uncaughtException", (error) => {
    logger.fatal({ error: error.message, stack: error.stack }, "Uncaught exception");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error(
      { reason: reason instanceof Error ? reason.message : String(reason) },
      "Unhandled rejection",
    );
  });
}

main().catch((error) => {
  logger.fatal(
    { error: error instanceof Error ? error.message : String(error) },
    "Fatal startup error",
  );
  process.exit(1);
});
