/**
 * Routes: /api/alerts
 *
 * - GET /api/alerts        — paginated list, filterable by severity
 * - GET /api/alerts/active — currently unresolved alerts
 */

import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { alerts } from "../../db/schema.js";
import { eq, desc, isNull, and, sql } from "drizzle-orm";

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  // -----------------------------------------------------------------------
  // GET /api/alerts
  // -----------------------------------------------------------------------
  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      severity?: string;
      safeAddress?: string;
    };
  }>("/api/alerts", async (req, reply) => {
    const page = Math.max(parseInt(req.query.page || "1"), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "50"), 1), 200);
    const offset = (page - 1) * limit;

    const conditions: ReturnType<typeof eq>[] = [];

    if (req.query.severity) {
      conditions.push(eq(alerts.severity, req.query.severity.toUpperCase()));
    }
    if (req.query.safeAddress) {
      conditions.push(
        eq(alerts.safeAddress, req.query.safeAddress.toLowerCase()),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [alertRows, countResult] = await Promise.all([
      db
        .select()
        .from(alerts)
        .where(where)
        .orderBy(desc(alerts.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(alerts)
        .where(where),
    ]);

    const total = countResult[0]?.count ?? 0;

    return reply.send({
      data: alertRows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/alerts/active
  // -----------------------------------------------------------------------
  app.get("/api/alerts/active", async (_req, reply) => {
    const activeAlerts = await db
      .select()
      .from(alerts)
      .where(isNull(alerts.resolvedAt))
      .orderBy(desc(alerts.createdAt));

    return reply.send({
      data: activeAlerts,
      count: activeAlerts.length,
    });
  });
}
