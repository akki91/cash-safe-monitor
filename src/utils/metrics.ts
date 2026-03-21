/**
 * Prometheus metrics registry.
 *
 * Centralises all custom metrics and enables default Node.js process
 * metrics (memory, CPU, event-loop lag).  Individual metric objects
 * are exported so instrumentation sites can import only what they need.
 */

import client, {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

// Use the global default registry
export const metricsRegistry: Registry = client.register;

// Collect Node.js process metrics (RSS, heap, CPU, event-loop lag, etc.)
collectDefaultMetrics({ register: metricsRegistry });

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"] as const,
});

// ---------------------------------------------------------------------------
// Poll cycle
// ---------------------------------------------------------------------------

export const pollCycleDuration = new Histogram({
  name: "poll_cycle_duration_seconds",
  help: "Duration of a full poll cycle in seconds",
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
});

export const pollCycleSafesProcessed = new Counter({
  name: "poll_cycle_safes_processed",
  help: "Total number of safes processed across poll cycles",
});

export const pollCycleErrorsTotal = new Counter({
  name: "poll_cycle_errors_total",
  help: "Total number of errors during poll cycles",
});

export const safesByHealthSeverity = new Gauge({
  name: "safes_by_health_severity",
  help: "Number of safes grouped by health severity",
  labelNames: ["severity"] as const,
});

export const safesTotal = new Gauge({
  name: "safes_total",
  help: "Total number of monitored safes",
});

// ---------------------------------------------------------------------------
// BullMQ jobs
// ---------------------------------------------------------------------------

export const bullmqJobDuration = new Histogram({
  name: "bullmq_job_duration_seconds",
  help: "Duration of BullMQ job execution in seconds",
  labelNames: ["job_type"] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
});

export const bullmqJobsTotal = new Counter({
  name: "bullmq_jobs_total",
  help: "Total number of BullMQ jobs processed",
  labelNames: ["job_type", "status"] as const,
});

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

export const wsClientsConnected = new Gauge({
  name: "ws_clients_connected",
  help: "Number of currently connected WebSocket clients",
});

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export const alertsFiredTotal = new Counter({
  name: "alerts_fired_total",
  help: "Total number of alerts fired",
  labelNames: ["severity"] as const,
});
