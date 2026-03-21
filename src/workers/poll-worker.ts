/**
 * BullMQ worker that processes health poll jobs.
 *
 * Listens on the "health-poll" queue and delegates to the
 * HealthPollerService for the actual on-chain reads and DB writes.
 */

import { Worker, type Job } from "bullmq";
import { type PollJobData } from "./poll-queue.js";
import { HealthPollerService } from "../services/health-poller.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { bullmqJobDuration, bullmqJobsTotal } from "../utils/metrics.js";

let worker: Worker<PollJobData> | null = null;
let pollerService: HealthPollerService | null = null;

/**
 * Start the BullMQ worker. Should be called once at application startup.
 */
export function startPollWorker(): Worker<PollJobData> {
  if (worker) return worker;

  pollerService = new HealthPollerService();

  worker = new Worker<PollJobData>(
    "health-poll",
    async (job: Job<PollJobData>) => {
      const jobStart = process.hrtime.bigint();
      const data = job.data;

      switch (data.type) {
        case "poll-all": {
          logger.info({ jobId: job.id }, "Processing poll-all job");
          await pollerService!.pollAll();
          break;
        }

        case "poll-single": {
          logger.info(
            { jobId: job.id, address: data.address },
            "Processing poll-single job",
          );
          await pollerService!.pollSafe(data.address);
          break;
        }

        default: {
          logger.warn({ jobId: job.id, data }, "Unknown job type");
        }
      }

      const durationMs = Number(process.hrtime.bigint() - jobStart) / 1e6;
      bullmqJobDuration.labels(data.type).observe(durationMs / 1000);
      bullmqJobsTotal.labels(data.type, "success").inc();

      logger.info(
        {
          telemetry: "job_completed",
          jobId: job.id,
          jobType: data.type,
          durationMs: +durationMs.toFixed(2),
          attempts: job.attemptsMade,
        },
        "Job completed",
      );
    },
    {
      connection: {
        url: config.redis.url,
        maxRetriesPerRequest: null,
      },
      concurrency: 1, // Serialize polls to avoid RPC rate-limit issues
      limiter: {
        max: 5,
        duration: 10_000, // At most 5 jobs per 10 seconds
      },
    },
  );

  worker.on("failed", (job, error) => {
    if (job?.data?.type) {
      bullmqJobsTotal.labels(job.data.type, "failure").inc();
    }

    logger.error(
      {
        telemetry: "job_failed",
        jobId: job?.id,
        jobType: job?.data?.type,
        attempts: job?.attemptsMade,
        error: error.message,
      },
      "Poll job failed",
    );
  });

  worker.on("error", (error) => {
    logger.error({ error: error.message }, "Poll worker error");
  });

  logger.info("Poll worker started");
  return worker;
}

/**
 * Gracefully stop the worker.
 */
export async function stopPollWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    pollerService = null;
    logger.info("Poll worker stopped");
  }
}
