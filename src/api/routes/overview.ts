/**
 * Routes: /api/overview
 *
 * Aggregate stats across all monitored safes.
 */

import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { userSafes, alerts } from "../../db/schema.js";
import { sql, eq, isNull, isNotNull, and, lte } from "drizzle-orm";

export async function overviewRoutes(app: FastifyInstance): Promise<void> {
  // -----------------------------------------------------------------------
  // GET /api/overview
  // -----------------------------------------------------------------------
  app.get("/api/overview", async (_req, reply) => {
    // Run all aggregate queries in parallel
    const [
      totalSafesResult,
      tvlResult,
      debtResult,
      avgHealthResult,
      atRiskResult,
      liquidatableResult,
      activeAlertsResult,
      distributionResult,
    ] = await Promise.all([
      // Total safes (only those successfully polled)
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(userSafes)
        .where(isNotNull(userSafes.lastPolledAt)),

      // Total collateral TVL — sum of latest currentHealth is not TVL,
      // but we can approximate from the safe_snapshots. For a lightweight
      // overview we query the user_safes table metadata and recent snapshots.
      // A more accurate approach would use a materialised view; for now we
      // rely on the most recent snapshot per safe. Here we use a simpler
      // approach: count safes with debt.
      db
        .select({
          totalCollateral: sql<string>`coalesce(sum(ss.total_collateral_usd), 0)`,
        })
        .from(sql`(
          SELECT DISTINCT ON (safe_address)
            safe_address, total_collateral_usd
          FROM safe_snapshots
          ORDER BY safe_address, created_at DESC
        ) ss`),

      // Total debt
      db
        .select({
          totalDebt: sql<string>`coalesce(sum(ss.total_debt_usd), 0)`,
        })
        .from(sql`(
          SELECT DISTINCT ON (safe_address)
            safe_address, total_debt_usd
          FROM safe_snapshots
          ORDER BY safe_address, created_at DESC
        ) ss`),

      // Average health factor (only for safes with debt)
      db
        .select({
          avgHealth: sql<string>`coalesce(avg(current_health::numeric), 0)`,
        })
        .from(userSafes)
        .where(eq(userSafes.hasDebt, true)),

      // Safes at risk (HF < 1.5 AND has debt)
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(userSafes)
        .where(
          and(
            eq(userSafes.hasDebt, true),
            lte(userSafes.currentHealth, "1.5"),
          ),
        ),

      // Liquidatable safes (HF <= 1.0 AND has debt)
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(userSafes)
        .where(
          and(
            eq(userSafes.hasDebt, true),
            lte(userSafes.currentHealth, "1.0"),
          ),
        ),

      // Active (unresolved) alerts
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(alerts)
        .where(isNull(alerts.resolvedAt)),

      // Health factor distribution buckets (polled safes only, no-debt separate)
      db
        .select({
          bucket: sql<string>`
            CASE
              WHEN has_debt = false THEN 'no-debt'
              WHEN current_health::numeric > 2.0 THEN '>2.0'
              WHEN current_health::numeric > 1.5 THEN '1.5-2.0'
              WHEN current_health::numeric > 1.2 THEN '1.2-1.5'
              WHEN current_health::numeric > 1.0 THEN '1.0-1.2'
              ELSE '<=1.0'
            END
          `,
          count: sql<number>`count(*)::int`,
        })
        .from(userSafes)
        .where(isNotNull(userSafes.lastPolledAt))
        .groupBy(sql`
          CASE
            WHEN has_debt = false THEN 'no-debt'
            WHEN current_health::numeric > 2.0 THEN '>2.0'
            WHEN current_health::numeric > 1.5 THEN '1.5-2.0'
            WHEN current_health::numeric > 1.2 THEN '1.2-1.5'
            WHEN current_health::numeric > 1.0 THEN '1.0-1.2'
            ELSE '<=1.0'
          END
        `),
    ]);

    // Build distribution map with defaults
    const distribution: Record<string, number> = {
      ">2.0": 0,
      "1.5-2.0": 0,
      "1.2-1.5": 0,
      "1.0-1.2": 0,
      "<=1.0": 0,
      "no-debt": 0,
    };
    for (const row of distributionResult) {
      distribution[row.bucket] = row.count;
    }

    return reply.send({
      data: {
        totalSafes: totalSafesResult[0]?.count ?? 0,
        totalCollateralUsd: parseFloat(tvlResult[0]?.totalCollateral ?? "0"),
        totalDebtUsd: parseFloat(debtResult[0]?.totalDebt ?? "0"),
        averageHealthFactor: parseFloat(avgHealthResult[0]?.avgHealth ?? "0"),
        safesAtRisk: atRiskResult[0]?.count ?? 0,
        safesLiquidatable: liquidatableResult[0]?.count ?? 0,
        activeAlerts: activeAlertsResult[0]?.count ?? 0,
        healthDistribution: distribution,
      },
    });
  });
}
