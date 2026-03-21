/**
 * Routes: /api/safes
 *
 * - GET /api/safes           — paginated list, sortable/filterable
 * - GET /api/safes/:address  — single safe detail with latest snapshot
 * - GET /api/safes/:address/history — health factor time-series
 */

import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { userSafes, safeSnapshots } from "../../db/schema.js";
import { eq, asc, desc, gte, lte, and, sql, isNotNull } from "drizzle-orm";

export async function safesRoutes(app: FastifyInstance): Promise<void> {
  // -----------------------------------------------------------------------
  // GET /api/safes
  // -----------------------------------------------------------------------
  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      sort?: string;
      order?: string;
      minHealth?: string;
      maxHealth?: string;
      hasDebt?: string;
    };
  }>("/api/safes", async (req, reply) => {
    const page = Math.max(parseInt(req.query.page || "1"), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "50"), 1), 200);
    const offset = (page - 1) * limit;
    const sortField = req.query.sort || "current_health";
    const sortOrder = req.query.order === "desc" ? "desc" : "asc";

    // Build WHERE conditions — always exclude safes that were never polled
    // (no data fetched successfully from RPC)
    const conditions: ReturnType<typeof eq>[] = [
      isNotNull(userSafes.lastPolledAt),
    ];

    if (req.query.minHealth) {
      conditions.push(
        gte(userSafes.currentHealth, req.query.minHealth),
      );
    }
    if (req.query.maxHealth) {
      conditions.push(
        lte(userSafes.currentHealth, req.query.maxHealth),
      );
    }
    if (req.query.hasDebt === "true") {
      conditions.push(eq(userSafes.hasDebt, true));
    }
    if (req.query.hasDebt === "false") {
      conditions.push(eq(userSafes.hasDebt, false));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Determine ORDER BY column
    const orderColumn =
      sortField === "discovered_at"
        ? userSafes.discoveredAt
        : sortField === "last_polled_at"
          ? userSafes.lastPolledAt
          : userSafes.currentHealth;

    const orderFn = sortOrder === "desc" ? desc : asc;

    const [safes, countResult] = await Promise.all([
      db
        .select()
        .from(userSafes)
        .where(where)
        .orderBy(orderFn(orderColumn))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(userSafes)
        .where(where),
    ]);

    const total = countResult[0]?.count ?? 0;

    return reply.send({
      data: safes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/safes/:address
  // -----------------------------------------------------------------------
  app.get<{
    Params: { address: string };
  }>("/api/safes/:address", async (req, reply) => {
    const address = req.params.address.toLowerCase();

    const safe = await db
      .select()
      .from(userSafes)
      .where(eq(userSafes.address, address))
      .limit(1);

    if (safe.length === 0) {
      return reply.status(404).send({ error: "Safe not found" });
    }

    // Fetch the latest snapshot
    const latestSnapshot = await db
      .select()
      .from(safeSnapshots)
      .where(eq(safeSnapshots.safeAddress, address))
      .orderBy(desc(safeSnapshots.createdAt))
      .limit(1);

    return reply.send({
      data: {
        ...safe[0],
        latestSnapshot: latestSnapshot[0] ?? null,
      },
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/safes/:address/history
  // -----------------------------------------------------------------------
  app.get<{
    Params: { address: string };
    Querystring: { days?: string };
  }>("/api/safes/:address/history", async (req, reply) => {
    const address = req.params.address.toLowerCase();
    const days = Math.min(Math.max(parseInt(req.query.days || "7"), 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const snapshots = await db
      .select({
        id: safeSnapshots.id,
        healthFactor: safeSnapshots.healthFactor,
        totalCollateralUsd: safeSnapshots.totalCollateralUsd,
        totalDebtUsd: safeSnapshots.totalDebtUsd,
        maxBorrowUsd: safeSnapshots.maxBorrowUsd,
        isLiquidatable: safeSnapshots.isLiquidatable,
        createdAt: safeSnapshots.createdAt,
      })
      .from(safeSnapshots)
      .where(
        and(
          eq(safeSnapshots.safeAddress, address),
          gte(safeSnapshots.createdAt, since),
        ),
      )
      .orderBy(asc(safeSnapshots.createdAt));

    return reply.send({
      data: snapshots,
      meta: { address, days, count: snapshots.length },
    });
  });
}
