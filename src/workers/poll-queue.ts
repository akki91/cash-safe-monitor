/**
 * BullMQ queue definitions for health polling jobs.
 */

import { Queue } from "bullmq";
import { config } from "../config.js";

// ---------------------------------------------------------------------------
// Job data interfaces
// ---------------------------------------------------------------------------

/** Poll every known safe in one pass. */
export interface PollAllJobData {
  type: "poll-all";
}

/** Poll a single safe by address. */
export interface PollSingleJobData {
  type: "poll-single";
  address: string;
}

export type PollJobData = PollAllJobData | PollSingleJobData;

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export const healthPollQueue = new Queue<PollJobData>("health-poll", {
  connection: {
    url: config.redis.url,
    maxRetriesPerRequest: null,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5_000,
    },
    removeOnComplete: {
      count: 1000,
    },
    removeOnFail: {
      count: 5000,
    },
  },
});

/**
 * Schedule a recurring poll-all job. Uses BullMQ's repeat/cron support.
 */
export async function scheduleRecurringPoll(): Promise<void> {
  // Remove any existing repeatable job to avoid duplicates on restart
  const existing = await healthPollQueue.getRepeatableJobs();
  for (const job of existing) {
    await healthPollQueue.removeRepeatableByKey(job.key);
  }

  await healthPollQueue.add(
    "recurring-poll",
    { type: "poll-all" } as PollJobData,
    {
      repeat: {
        every: config.polling.intervalMs,
      },
    },
  );
}

