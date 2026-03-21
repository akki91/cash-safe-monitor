/**
 * Periodic system resource stats logger.
 *
 * Emits a `telemetry: "system_stats"` log every 60 seconds with
 * memory usage, uptime, and PID. The timer is `.unref()`'d so it
 * does not prevent Node.js from exiting naturally.
 */

import { logger } from "./logger.js";

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start logging system stats at a fixed interval.
 */
export function startSystemStatsLogger(intervalMs = 60_000): void {
  if (timer) return;

  timer = setInterval(() => {
    const mem = process.memoryUsage();
    logger.info(
      {
        telemetry: "system_stats",
        uptimeSeconds: +process.uptime().toFixed(1),
        memory: {
          rssMb: +(mem.rss / 1024 / 1024).toFixed(2),
          heapUsedMb: +(mem.heapUsed / 1024 / 1024).toFixed(2),
          heapTotalBytes: mem.heapTotal,
          rssBytes: mem.rss,
        },
        pid: process.pid,
      },
      "System stats",
    );
  }, intervalMs);

  timer.unref();
}

/**
 * Stop the system stats logger and clean up the timer.
 */
export function stopSystemStatsLogger(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
