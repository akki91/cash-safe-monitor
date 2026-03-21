/**
 * AlertEngine
 *
 * Evaluates health metrics for a safe against severity thresholds, creates
 * alert records in the database (with deduplication via cooldown), and
 * dispatches notifications for WARNING-level and above.
 */

import { and, eq, isNull, gt, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { alerts } from "../db/schema.js";
import { logger } from "../utils/logger.js";
import {
  getHealthSeverity,
  type HealthMetrics,
  type HealthSeverity,
} from "../utils/health-calc.js";
import { config } from "../config.js";
import { Notifier } from "./notifier.js";
import { alertsFiredTotal } from "../utils/metrics.js";

/** Severities that warrant a notification push. */
const NOTIFY_SEVERITIES: Set<HealthSeverity> = new Set([
  "WARNING",
  "CRITICAL",
  "LIQUIDATABLE",
]);

export class AlertEngine {
  private notifier: Notifier;

  constructor(notifier?: Notifier) {
    this.notifier = notifier ?? new Notifier();
  }

  /**
   * Evaluate health metrics for a safe and potentially create an alert.
   *
   * Alert creation is suppressed if an alert of the same (or higher) severity
   * already exists for this safe within the configured cooldown window.
   */
  async evaluate(
    safeAddress: string,
    metrics: HealthMetrics,
  ): Promise<void> {
    const severity = getHealthSeverity(metrics.healthFactor);

    // No alert needed for healthy safes
    if (severity === "HEALTHY") return;

    // Deduplicate: skip if a matching alert was raised within the cooldown
    const isDuplicate = await this.isWithinCooldown(safeAddress, severity);
    if (isDuplicate) {
      logger.debug(
        { safe: safeAddress, severity },
        "Alert suppressed — within cooldown",
      );
      return;
    }

    // Build the alert record
    const message = this.formatMessage(safeAddress, severity, metrics);
    const details = {
      totalCollateralUsd: metrics.totalCollateralUsd,
      totalDebtUsd: metrics.totalDebtUsd,
      maxBorrowUsd: metrics.maxBorrowUsd,
      healthFactor: isFinite(metrics.healthFactor) ? metrics.healthFactor : null,
      isLiquidatable: metrics.isLiquidatable,
    };

    await db.insert(alerts).values({
      safeAddress,
      severity,
      healthFactor: isFinite(metrics.healthFactor)
        ? metrics.healthFactor.toFixed(6)
        : "999999.000000",
      message,
      details,
      createdAt: new Date(),
    });

    alertsFiredTotal.labels(severity).inc();

    logger.info(
      { safe: safeAddress, severity, hf: metrics.healthFactor },
      "Alert created",
    );

    // Dispatch notification for actionable severities
    if (NOTIFY_SEVERITIES.has(severity)) {
      await this.notifier.sendAlert({
        safeAddress,
        severity,
        healthFactor: metrics.healthFactor,
        message,
        details,
      });
    }
  }

  /**
   * Resolve any open (unresolved) alerts for a safe when its health factor
   * recovers above all thresholds.
   */
  async resolveAlerts(
    safeAddress: string,
    currentHF: number,
  ): Promise<void> {
    const now = new Date();

    const openAlerts = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.safeAddress, safeAddress),
          isNull(alerts.resolvedAt),
        ),
      );

    if (openAlerts.length === 0) return;

    for (const alert of openAlerts) {
      // Only resolve if the current HF is above the threshold for that severity
      const thresholdForSeverity = this.severityThreshold(
        alert.severity as HealthSeverity,
      );
      if (currentHF > thresholdForSeverity) {
        await db
          .update(alerts)
          .set({ resolvedAt: now })
          .where(eq(alerts.id, alert.id));

        logger.info(
          {
            safe: safeAddress,
            alertId: alert.id.toString(),
            severity: alert.severity,
            currentHF,
          },
          "Alert resolved",
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Check whether an alert of the given severity (or higher) was already
   * created for this safe within the cooldown window.
   */
  private async isWithinCooldown(
    safeAddress: string,
    severity: HealthSeverity,
  ): Promise<boolean> {
    const cooldownMs = config.alerts.cooldownMinutes * 60 * 1000;
    const cutoff = new Date(Date.now() - cooldownMs);

    const recent = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.safeAddress, safeAddress),
          eq(alerts.severity, severity),
          gt(alerts.createdAt, cutoff),
        ),
      )
      .orderBy(desc(alerts.createdAt))
      .limit(1);

    return recent.length > 0;
  }

  /**
   * Return the HF threshold above which an alert of the given severity
   * should be considered resolved.
   */
  private severityThreshold(severity: HealthSeverity): number {
    switch (severity) {
      case "LIQUIDATABLE":
        return 1.0;
      case "CRITICAL":
        return 1.2;
      case "WARNING":
        return 1.5;
      case "INFO":
        return 2.0;
      default:
        return Infinity;
    }
  }

  /**
   * Build a human-readable alert message.
   */
  private formatMessage(
    safeAddress: string,
    severity: HealthSeverity,
    metrics: HealthMetrics,
  ): string {
    const hf = isFinite(metrics.healthFactor)
      ? metrics.healthFactor.toFixed(4)
      : "N/A";

    switch (severity) {
      case "LIQUIDATABLE":
        return (
          `LIQUIDATABLE: Safe ${safeAddress} has HF=${hf}. ` +
          `Collateral $${metrics.totalCollateralUsd.toFixed(2)}, ` +
          `Debt $${metrics.totalDebtUsd.toFixed(2)}.`
        );
      case "CRITICAL":
        return (
          `CRITICAL: Safe ${safeAddress} health factor dropped to ${hf}. ` +
          `Collateral $${metrics.totalCollateralUsd.toFixed(2)}, ` +
          `Debt $${metrics.totalDebtUsd.toFixed(2)}.`
        );
      case "WARNING":
        return (
          `WARNING: Safe ${safeAddress} health factor at ${hf}. ` +
          `Approaching critical threshold.`
        );
      case "INFO":
        return `INFO: Safe ${safeAddress} health factor is ${hf}, below 2.0.`;
      default:
        return `Safe ${safeAddress} health factor: ${hf}`;
    }
  }
}
