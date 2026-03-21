/**
 * HealthPollerService
 *
 * Periodically polls the on-chain health of all known user safes via the
 * CashLens contract.
 *
 * After each poll round the service:
 *   1. Stores a snapshot into safe_snapshots
 *   2. Updates the safe's current_health / has_debt / last_polled_at
 *   3. Feeds the health metrics to the AlertEngine for evaluation
 *   4. Broadcasts updates to WebSocket subscribers
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userSafes, safeSnapshots } from "../db/schema.js";
import { logger } from "../utils/logger.js";
import { batchGetSafeData, resolveTokenMetadata, type SafeRpcData } from "../utils/multicall.js";
import {
  getHealthSeverity,
  getPollingInterval,
  type HealthMetrics,
} from "../utils/health-calc.js";
import { AlertEngine } from "./alert-engine.js";
import { config } from "../config.js";
import { broadcastHealthUpdate } from "../api/ws/health.js";
import {
  pollCycleDuration,
  pollCycleSafesProcessed,
  pollCycleErrorsTotal,
  safesByHealthSeverity,
  safesTotal,
} from "../utils/metrics.js";

/** Precision divisor — on-chain USD values use 6 decimals. */
const USD_DECIMALS = 1e6;

export class HealthPollerService {
  private alertEngine: AlertEngine;
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private running = false;

  constructor(alertEngine?: AlertEngine) {
    this.alertEngine = alertEngine ?? new AlertEngine();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Poll all known safes.
   */
  async pollAll(): Promise<void> {
    const cycleStart = process.hrtime.bigint();
    const safes = await db.select().from(userSafes);

    if (safes.length === 0) {
      logger.info("No safes to poll");
      return;
    }

    logger.info({ count: safes.length }, "Polling all safes");

    const addresses = safes.map((s) => s.address);
    const batchResults = await batchGetSafeData(
      addresses,
      config.polling.multicallBatchSize,
    );

    let processed = 0;
    let errors = 0;
    const distribution = { healthy: 0, info: 0, warning: 0, critical: 0, liquidatable: 0, noDebt: 0 };

    for (const rpcData of batchResults) {
      try {
        const metrics = await this.processSafeData(rpcData);
        processed++;
        if (metrics) {
          if (metrics.healthFactor === Infinity) {
            distribution.noDebt++;
          } else {
            const sev = getHealthSeverity(metrics.healthFactor);
            if (sev === "HEALTHY") distribution.healthy++;
            else if (sev === "INFO") distribution.info++;
            else if (sev === "WARNING") distribution.warning++;
            else if (sev === "CRITICAL") distribution.critical++;
            else distribution.liquidatable++;
          }
        } else {
          distribution.noDebt++;
        }
      } catch (error) {
        errors++;
        logger.error(
          {
            safe: rpcData.address,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to process safe data",
        );
      }
    }

    const cycleDurationMs = Number(process.hrtime.bigint() - cycleStart) / 1e6;
    const avgPerSafeMs = processed > 0 ? +(cycleDurationMs / processed).toFixed(2) : 0;

    // ---- Prometheus metrics ----
    pollCycleDuration.observe(cycleDurationMs / 1000);
    pollCycleSafesProcessed.inc(processed);
    pollCycleErrorsTotal.inc(errors);
    safesTotal.set(safes.length);
    safesByHealthSeverity.labels("healthy").set(distribution.healthy + distribution.noDebt);
    safesByHealthSeverity.labels("info").set(distribution.info);
    safesByHealthSeverity.labels("warning").set(distribution.warning);
    safesByHealthSeverity.labels("critical").set(distribution.critical);
    safesByHealthSeverity.labels("liquidatable").set(distribution.liquidatable);

    logger.info(
      {
        telemetry: "poll_cycle",
        processed,
        errors,
        total: safes.length,
        cycleDurationMs: +cycleDurationMs.toFixed(2),
        avgPerSafeMs,
        distribution,
      },
      "Poll round complete",
    );
  }

  /**
   * Poll a single safe by address.
   */
  async pollSafe(address: string): Promise<HealthMetrics | null> {
    const results = await batchGetSafeData([address]);
    if (results.length === 0) return null;
    return this.processSafeData(results[0]);
  }

  /**
   * Start continuous polling.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info("Starting health poller");
    await this.schedulePollCycle();
  }

  /**
   * Stop continuous polling and clear all timers.
   */
  stop(): void {
    this.running = false;
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    logger.info("Health poller stopped");
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Run one full poll cycle, then schedule the next one.
   */
  private async schedulePollCycle(): Promise<void> {
    if (!this.running) return;

    try {
      await this.pollAll();
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Poll cycle failed",
      );
    }

    if (this.running) {
      const timer = setTimeout(
        () => this.schedulePollCycle(),
        config.polling.intervalMs,
      );
      this.timers.set("__cycle__", timer);
    }
  }

  /**
   * Process raw RPC data for a single safe: compute metrics, persist
   * snapshot, update the safe row, evaluate alerts, broadcast WS update.
   */
  private async processSafeData(
    rpcData: SafeRpcData,
  ): Promise<HealthMetrics | null> {
    if (!rpcData.lensData) {
      logger.warn({ safe: rpcData.address }, "Skipping safe — no lens data");
      return null;
    }

    const lens = rpcData.lensData;

    // Convert on-chain 256-bit USD values (6 decimals) to JS numbers
    const totalCollateralUsd = Number(lens.totalCollateralInUsd) / USD_DECIMALS;
    const totalDebtUsd = Number(lens.totalBorrowInUsd) / USD_DECIMALS;
    const maxBorrowUsd = Number(lens.maxBorrowInUsd) / USD_DECIMALS;

    const healthFactor = totalDebtUsd > 0 ? maxBorrowUsd / totalDebtUsd : Infinity;
    const isLiquidatable = rpcData.isLiquidatable;

    // Resolve token symbols + decimals for collateral + debt tokens
    const allTokenAddrs = [
      ...lens.collateralTokens.map((t) => t.token),
      ...lens.borrowTokens.map((t) => t.token),
    ];
    const { symbols: symbolMap, decimals: decimalsMap } = allTokenAddrs.length > 0
      ? await resolveTokenMetadata(allTokenAddrs)
      : { symbols: new Map<string, string>(), decimals: new Map<string, number>() };

    // Build price lookup for per-token values
    const priceMap = new Map<string, number>();
    for (const tp of lens.tokenPrices) {
      priceMap.set(tp.token.toLowerCase(), tp.priceUsd);
    }

    // Build collateral / debt detail arrays for JSONB storage
    // Convert raw bigint balances to human-readable using token decimals
    const collateralDetails = lens.collateralTokens.map((t) => {
      const dec = decimalsMap.get(t.token.toLowerCase()) ?? 18;
      return {
        token: t.token,
        symbol: symbolMap.get(t.token.toLowerCase()) ?? t.token.slice(0, 8),
        balance: (Number(t.balance) / 10 ** dec).toString(),
        priceUsd: priceMap.get(t.token.toLowerCase()) ?? null,
      };
    });

    const debtDetails = lens.borrowTokens.map((t) => {
      const dec = decimalsMap.get(t.token.toLowerCase()) ?? 18;
      return {
        token: t.token,
        symbol: symbolMap.get(t.token.toLowerCase()) ?? t.token.slice(0, 8),
        amount: (Number(t.amount) / 10 ** dec).toString(),
        priceUsd: priceMap.get(t.token.toLowerCase()) ?? null,
      };
    });

    const hasDebt = totalDebtUsd > 0;

    // Represent Infinity as a very large number for DB storage
    const dbHealthFactor = isFinite(healthFactor) ? healthFactor : 999999;

    // Mode mapping: 0 = Credit, 1 = Debit
    const modeLabel = lens.mode === 0 ? "Credit" : "Debit";

    // Build extra data from CashLens
    const spendingLimitUsd = Number(lens.spendingLimitAllowance) / USD_DECIMALS;
    const creditMaxSpendUsd = Number(lens.creditMaxSpend) / USD_DECIMALS;
    const cashbackEarnedUsd = Number(lens.totalCashbackEarnedInUsd) / USD_DECIMALS;
    const debitTotalSpendableUsd = Number(lens.debitMaxSpend.totalSpendableInUsd) / USD_DECIMALS;

    const hasWithdrawalRequest =
      lens.withdrawalRequest.tokens.length > 0 &&
      Number(lens.withdrawalRequest.withdrawalRequestTimestamp) > 0;

    const extraData = {
      tokenPrices: lens.tokenPrices.map((tp) => ({
        token: tp.token,
        symbol: symbolMap.get(tp.token.toLowerCase()) ?? tp.token.slice(0, 8),
        priceUsd: tp.priceUsd,
      })),
      spendingLimitUsd,
      creditMaxSpendUsd,
      cashbackEarnedUsd,
      debitMaxSpend: {
        totalSpendableUsd: debitTotalSpendableUsd,
        tokens: lens.debitMaxSpend.spendableTokens.map((t, i) => {
          const dec = decimalsMap.get(t.toLowerCase()) ?? 18;
          const rawAmount = lens.debitMaxSpend.spendableAmounts[i] ?? 0n;
          return {
            token: t,
            symbol: symbolMap.get(t.toLowerCase()) ?? t.slice(0, 8),
            amount: (Number(rawAmount) / 10 ** dec).toString(),
            valueUsd: Number(lens.debitMaxSpend.amountsInUsd[i] ?? 0n) / USD_DECIMALS,
          };
        }),
      },
      withdrawalRequest: hasWithdrawalRequest
        ? {
            tokens: lens.withdrawalRequest.tokens.map((t, i) => {
              const dec = decimalsMap.get(t.toLowerCase()) ?? 18;
              const rawAmount = lens.withdrawalRequest.amounts[i] ?? 0n;
              return {
                token: t,
                symbol: symbolMap.get(t.toLowerCase()) ?? t.slice(0, 8),
                amount: (Number(rawAmount) / 10 ** dec).toString(),
              };
            }),
            requestedAt: Number(lens.withdrawalRequest.withdrawalRequestTimestamp),
            finalizesAt: Number(lens.withdrawalRequest.finalizeTimestamp),
          }
        : null,
    };

    // ---- Persist snapshot ----
    await db.insert(safeSnapshots).values({
      safeAddress: rpcData.address,
      totalCollateralUsd: totalCollateralUsd.toFixed(6),
      totalDebtUsd: totalDebtUsd.toFixed(6),
      maxBorrowUsd: maxBorrowUsd.toFixed(6),
      healthFactor: dbHealthFactor.toFixed(6),
      collateralDetails,
      debtDetails,
      isLiquidatable,
      extraData,
      createdAt: new Date(),
    });

    // ---- Update safe row ----
    await db
      .update(userSafes)
      .set({
        currentHealth: dbHealthFactor.toFixed(6),
        totalCollateralUsd: totalCollateralUsd.toFixed(6),
        totalDebtUsd: totalDebtUsd.toFixed(6),
        isLiquidatable,
        hasDebt,
        lastPolledAt: new Date(),
        mode: modeLabel,
      })
      .where(eq(userSafes.address, rpcData.address));

    // ---- Build metrics for downstream consumers ----
    const metrics: HealthMetrics = {
      totalCollateralUsd,
      totalDebtUsd,
      maxBorrowUsd,
      healthFactor,
      isLiquidatable,
    };

    // ---- Alert evaluation ----
    await this.alertEngine.evaluate(rpcData.address, metrics);

    // If health factor has recovered, resolve old alerts
    if (healthFactor > 2.0) {
      await this.alertEngine.resolveAlerts(rpcData.address, healthFactor);
    }

    // ---- WebSocket broadcast ----
    broadcastHealthUpdate({
      safeAddress: rpcData.address,
      healthFactor,
      totalCollateralUsd,
      totalDebtUsd,
      isLiquidatable,
      timestamp: new Date().toISOString(),
    });

    return metrics;
  }
}
