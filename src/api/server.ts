/**
 * Fastify API server setup.
 *
 * Registers:
 *   - CORS support
 *   - WebSocket plugin
 *   - All REST route handlers
 *   - Health-check endpoint
 */

import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import {
  metricsRegistry,
  httpRequestDuration,
  httpRequestsTotal,
} from "../utils/metrics.js";

declare module "fastify" {
  interface FastifyRequest {
    startTime?: bigint;
  }
}

// Route registrations
import { safesRoutes } from "./routes/safes.js";
import { alertsRoutes } from "./routes/alerts.js";
import { overviewRoutes } from "./routes/overview.js";
import { configRoutes } from "./routes/config.js";
import { registerHealthWs } from "./ws/health.js";

async function createServer() {
  const app = Fastify({
    logger: false, // We use our own pino logger
  });

  // BigInt values (e.g. bigserial IDs) are not JSON-serializable by default.
  // This reply serializer converts them to strings automatically.
  app.setReplySerializer((payload) => {
    return JSON.stringify(payload, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  });

  // -----------------------------------------------------------------------
  // Plugins
  // -----------------------------------------------------------------------
  await app.register(cors, {
    origin: true, // Allow all origins in dev; tighten for production
  });

  await app.register(websocket);

  // -----------------------------------------------------------------------
  // Request / response telemetry
  // -----------------------------------------------------------------------
  app.addHook("onRequest", async (req: FastifyRequest) => {
    req.startTime = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (req, reply) => {
    const durationMs = req.startTime
      ? Number(process.hrtime.bigint() - req.startTime) / 1e6
      : undefined;

    // Strip dynamic path segments for a low-cardinality route label
    const route = req.routeOptions?.url ?? req.url;
    const status = String(reply.statusCode);

    if (durationMs !== undefined) {
      httpRequestDuration
        .labels(req.method, route, status)
        .observe(durationMs / 1000);
    }
    httpRequestsTotal.labels(req.method, route, status).inc();

    logger.info(
      {
        telemetry: "http_request",
        reqId: req.id,
        method: req.method,
        url: req.url,
        statusCode: reply.statusCode,
        durationMs: durationMs ? +durationMs.toFixed(2) : undefined,
      },
      "HTTP request completed",
    );
  });

  // -----------------------------------------------------------------------
  // Prometheus metrics
  // -----------------------------------------------------------------------
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", metricsRegistry.contentType);
    return reply.send(await metricsRegistry.metrics());
  });

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------
  app.get("/health", async (_req, reply) => {
    const mem = process.memoryUsage();
    return reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      rssMb: +(mem.rss / 1024 / 1024).toFixed(2),
      heapUsedMb: +(mem.heapUsed / 1024 / 1024).toFixed(2),
    });
  });

  // -----------------------------------------------------------------------
  // REST routes
  // -----------------------------------------------------------------------
  await app.register(safesRoutes);
  await app.register(alertsRoutes);
  await app.register(overviewRoutes);
  await app.register(configRoutes);

  // -----------------------------------------------------------------------
  // WebSocket routes
  // -----------------------------------------------------------------------
  await registerHealthWs(app);

  // -----------------------------------------------------------------------
  // Global error handler
  // -----------------------------------------------------------------------
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    logger.error({ err: error }, "Unhandled API error");
    reply.status(error.statusCode ?? 500).send({
      error: error.message || "Internal Server Error",
    });
  });

  return app;
}

/**
 * Start the Fastify server on the configured host/port.
 */
export async function startServer() {
  const app = await createServer();

  await app.listen({
    port: config.api.port,
    host: config.api.host,
  });

  logger.info(
    { port: config.api.port, host: config.api.host },
    "API server listening",
  );

  return app;
}
