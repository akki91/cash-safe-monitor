/**
 * Health factor types and utilities.
 *
 * Health data is fetched on-chain via CashLens — these utilities
 * provide severity classification and adaptive polling intervals.
 */

export interface HealthMetrics {
  totalCollateralUsd: number;
  totalDebtUsd: number;
  maxBorrowUsd: number;
  /** maxBorrowUsd / totalDebtUsd — Infinity when there is no debt */
  healthFactor: number;
  isLiquidatable: boolean;
}

export type HealthSeverity =
  | "HEALTHY"
  | "INFO"
  | "WARNING"
  | "CRITICAL"
  | "LIQUIDATABLE";

/**
 * Map a health factor value to a severity level.
 */
export function getHealthSeverity(healthFactor: number): HealthSeverity {
  if (healthFactor === Infinity || healthFactor > 2.0) return "HEALTHY";
  if (healthFactor > 1.5) return "INFO";
  if (healthFactor > 1.2) return "WARNING";
  if (healthFactor > 1.0) return "CRITICAL";
  return "LIQUIDATABLE";
}

/**
 * Return a dynamic polling interval (in milliseconds) based on the current
 * health factor. Riskier safes are polled more frequently.
 *
 * | HF range          | Interval  |
 * |--------------------|----------|
 * | Infinity / no debt | 15 min   |
 * | > 2.0              | 5 min    |
 * | > 1.5              | 2 min    |
 * | > 1.2              | 30 sec   |
 * | <= 1.2             | 10 sec   |
 */
export function getPollingInterval(healthFactor: number): number {
  if (healthFactor === Infinity) return 15 * 60 * 1000; // 15 minutes
  if (healthFactor > 2.0) return 5 * 60 * 1000; // 5 minutes
  if (healthFactor > 1.5) return 2 * 60 * 1000; // 2 minutes
  if (healthFactor > 1.2) return 30 * 1000; // 30 seconds
  return 10 * 1000; // 10 seconds
}
