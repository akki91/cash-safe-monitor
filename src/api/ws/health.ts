/**
 * WebSocket handler for real-time health updates.
 *
 * Clients connect to /ws/health and receive JSON-encoded health updates
 * whenever a safe is polled.
 */

import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { logger } from "../../utils/logger.js";
import { wsClientsConnected } from "../../utils/metrics.js";

/** Set of currently connected WebSocket clients. */
const clients = new Set<WebSocket>();

/** Shape of a broadcasted health update. */
export interface HealthUpdateMessage {
  safeAddress: string;
  healthFactor: number;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  isLiquidatable: boolean;
  timestamp: string;
}

/**
 * Register the /ws/health WebSocket route on the Fastify instance.
 */
export async function registerHealthWs(app: FastifyInstance): Promise<void> {
  app.get(
    "/ws/health",
    { websocket: true },
    (socket, _req) => {
      clients.add(socket);
      wsClientsConnected.inc();
      logger.info(
        { telemetry: "ws_connect", clientCount: clients.size },
        "WebSocket client connected",
      );

      socket.on("message", (raw: Buffer) => {
        logger.debug({ message: raw.toString() }, "WS message received");
      });

      socket.on("close", () => {
        clients.delete(socket);
        wsClientsConnected.dec();
        logger.info(
          { telemetry: "ws_disconnect", clientCount: clients.size },
          "WebSocket client disconnected",
        );
      });

      socket.on("error", (err: Error) => {
        logger.error({ error: err.message }, "WebSocket client error");
        clients.delete(socket);
        wsClientsConnected.dec();
      });

      socket.send(
        JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }),
      );
    },
  );
}

/**
 * Broadcast a health update to all connected WebSocket clients.
 */
export function broadcastHealthUpdate(update: HealthUpdateMessage): void {
  if (clients.size === 0) return;

  const payload = JSON.stringify({
    type: "health-update",
    data: {
      ...update,
      healthFactor: isFinite(update.healthFactor)
        ? update.healthFactor
        : null,
    },
  });

  let delivered = 0;
  for (const client of clients) {
    try {
      if (client.readyState === 1) {
        client.send(payload);
        delivered++;
      }
    } catch {
      clients.delete(client);
    }
  }

  logger.debug(
    {
      telemetry: "ws_broadcast",
      safeAddress: update.safeAddress,
      recipientCount: clients.size,
      delivered,
    },
    "Broadcast health update",
  );
}
