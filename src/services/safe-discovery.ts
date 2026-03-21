/**
 * CSV-based safe address loader.
 *
 * Loads user safe addresses from a CSV file and bulk-inserts them into the
 * database. This replaces the previous hybrid discovery approach (Dune API +
 * event scan + WebSocket) with a simpler model where addresses are provided
 * upfront.
 *
 * Future: Safe Discovery Strategies
 *   - Dune API bootstrap: fast bulk fetch from public query (#5235398)
 *   - On-chain event scan: trustless UserSafeFactory event indexing
 *   - Live WebSocket watch: real-time new safe detection
 *   These would be implemented when the ether.fi team provides an API or
 *   when fully autonomous discovery is needed at scale.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { db } from "../db/index.js";
import { userSafes } from "../db/schema.js";
import { logger } from "../utils/logger.js";

const INSERT_BATCH_SIZE = 1000;
const LOG_PROGRESS_EVERY = 10_000;

/**
 * Load safe addresses from a CSV file and insert them into the database.
 *
 * Expects a CSV with a header row containing an `address` column.
 * Performs bulk inserts in batches of 1000 with onConflictDoNothing.
 *
 * @returns The number of addresses processed from the CSV.
 */
export async function loadSafesFromCsv(filePath: string): Promise<number> {
  logger.info({ filePath }, "Loading safe addresses from CSV");

  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let headerParsed = false;
  let addressColumnIndex = -1;
  let totalProcessed = 0;
  let batch: { address: string }[] = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!headerParsed) {
      // Parse header to find the address column
      const columns = trimmed.split(",").map((c) => c.trim().toLowerCase());
      addressColumnIndex = columns.indexOf("address");
      if (addressColumnIndex === -1) {
        throw new Error(
          `CSV header must contain an "address" column. Found: ${columns.join(", ")}`,
        );
      }
      headerParsed = true;
      continue;
    }

    const columns = trimmed.split(",");
    const address = columns[addressColumnIndex]?.trim().toLowerCase();

    if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
      continue; // Skip invalid addresses
    }

    batch.push({ address });
    totalProcessed++;

    if (batch.length >= INSERT_BATCH_SIZE) {
      await flushBatch(batch);
      batch = [];
    }

    if (totalProcessed % LOG_PROGRESS_EVERY === 0) {
      logger.info({ processed: totalProcessed }, "CSV loading progress");
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    await flushBatch(batch);
  }

  logger.info({ totalProcessed }, "CSV loading complete");
  return totalProcessed;
}

async function flushBatch(batch: { address: string }[]): Promise<void> {
  await db.insert(userSafes).values(batch).onConflictDoNothing();
}
