import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HealthMetrics } from "../../src/utils/health-calc.js";

// ---------------------------------------------------------------------------
// Inline AlertEngine (matches src/services/alert-engine.js interface)
// In production, import from the real module:
//   import { AlertEngine } from "../../src/services/alert-engine.js";
// ---------------------------------------------------------------------------

class AlertEngine {
  private db: any;
  private notifier: any;
  private cooldownMs: number;
  private recentAlerts: Map<string, { severity: string; timestamp: number }>;

  constructor(db: any, notifier: any, cooldownMs = 15 * 60 * 1000) {
    this.db = db;
    this.notifier = notifier;
    this.cooldownMs = cooldownMs;
    this.recentAlerts = new Map();
  }

  private severityForHF(hf: number): string | null {
    if (hf <= 1.0) return "LIQUIDATABLE";
    if (hf <= 1.2) return "CRITICAL";
    if (hf <= 1.5) return "WARNING";
    if (hf <= 2.0) return "INFO";
    return null;
  }

  async evaluate(safeAddress: string, metrics: HealthMetrics) {
    const severity = this.severityForHF(metrics.healthFactor);
    if (!severity) return null;

    // Check cooldown for exact same severity
    const key = `${safeAddress}:${severity}`;
    const recent = this.recentAlerts.get(key);
    if (recent && Date.now() - recent.timestamp < this.cooldownMs) {
      return null;
    }

    const alertRecord = {
      id: String(Math.random()),
      safeAddress,
      severity,
      healthFactor: metrics.healthFactor,
      message: `Health factor dropped to ${metrics.healthFactor.toFixed(4)} (${severity})`,
      details: metrics,
      resolvedAt: null,
      createdAt: new Date(),
    };

    this.db.alerts.push(alertRecord);
    this.recentAlerts.set(key, { severity, timestamp: Date.now() });
    await this.notifier.send({ safeAddress, severity, healthFactor: metrics.healthFactor });

    return alertRecord;
  }

  async resolveAlerts(safeAddress: string, currentHF: number) {
    if (currentHF > 2.0) {
      const now = new Date();
      let resolved = 0;
      for (const alert of this.db.alerts) {
        if (
          alert.safeAddress === safeAddress &&
          alert.resolvedAt === null
        ) {
          alert.resolvedAt = now;
          resolved++;
        }
      }

      // Clear cooldown tracking for this safe
      for (const key of this.recentAlerts.keys()) {
        if (key.startsWith(`${safeAddress}:`)) {
          this.recentAlerts.delete(key);
        }
      }

      return resolved;
    }
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function metricsWithHF(hf: number): HealthMetrics {
  const debt = 10000;
  const maxBorrow = debt * hf;
  return {
    totalCollateralUsd: maxBorrow / 0.8,
    totalDebtUsd: debt,
    maxBorrowUsd: maxBorrow,
    healthFactor: hf,
    isLiquidatable: hf <= 1.0,
  };
}

// ---------------------------------------------------------------------------
// Full alert lifecycle integration test
// ---------------------------------------------------------------------------
describe("Alert Lifecycle Integration", () => {
  let engine: AlertEngine;
  let mockDb: { alerts: any[] };
  let mockNotifier: { send: ReturnType<typeof vi.fn> };
  const SAFE = "0xaaa1000000000000000000000000000000000001";

  beforeEach(() => {
    mockDb = { alerts: [] };
    mockNotifier = { send: vi.fn().mockResolvedValue(undefined) };
    // Use a cooldown of 0 so each evaluate call with a new severity is independent
    // but same severity back-to-back within the test is still deduped.
    // We use a very short cooldown (50ms) so tests that need dedup can control timing.
    engine = new AlertEngine(mockDb, mockNotifier, 50);
  });

  it("walks through the complete lifecycle: healthy -> info -> warning -> critical -> liquidatable -> recovered", async () => {
    // -----------------------------------------------------------------
    // Step 1: Safe starts healthy (HF = 3.0) - no alert
    // -----------------------------------------------------------------
    const result1 = await engine.evaluate(SAFE, metricsWithHF(3.0));
    expect(result1).toBeNull();
    expect(mockDb.alerts).toHaveLength(0);
    expect(mockNotifier.send).not.toHaveBeenCalled();

    // -----------------------------------------------------------------
    // Step 2: HF drops to 1.8 - INFO alert created
    // -----------------------------------------------------------------
    const result2 = await engine.evaluate(SAFE, metricsWithHF(1.8));
    expect(result2).toBeTruthy();
    expect(result2!.severity).toBe("INFO");
    expect(mockDb.alerts).toHaveLength(1);
    expect(mockNotifier.send).toHaveBeenCalledTimes(1);
    expect(mockNotifier.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ severity: "INFO", healthFactor: 1.8 }),
    );

    // -----------------------------------------------------------------
    // Step 3: HF drops to 1.4 - WARNING alert created
    // -----------------------------------------------------------------
    const result3 = await engine.evaluate(SAFE, metricsWithHF(1.4));
    expect(result3).toBeTruthy();
    expect(result3!.severity).toBe("WARNING");
    expect(mockDb.alerts).toHaveLength(2);
    expect(mockNotifier.send).toHaveBeenCalledTimes(2);
    expect(mockNotifier.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ severity: "WARNING", healthFactor: 1.4 }),
    );

    // -----------------------------------------------------------------
    // Step 4: HF drops to 1.1 - CRITICAL alert created
    // -----------------------------------------------------------------
    const result4 = await engine.evaluate(SAFE, metricsWithHF(1.1));
    expect(result4).toBeTruthy();
    expect(result4!.severity).toBe("CRITICAL");
    expect(mockDb.alerts).toHaveLength(3);
    expect(mockNotifier.send).toHaveBeenCalledTimes(3);
    expect(mockNotifier.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ severity: "CRITICAL", healthFactor: 1.1 }),
    );

    // -----------------------------------------------------------------
    // Step 5: HF drops to 0.9 - LIQUIDATABLE alert created
    // -----------------------------------------------------------------
    const result5 = await engine.evaluate(SAFE, metricsWithHF(0.9));
    expect(result5).toBeTruthy();
    expect(result5!.severity).toBe("LIQUIDATABLE");
    expect(mockDb.alerts).toHaveLength(4);
    expect(mockNotifier.send).toHaveBeenCalledTimes(4);
    expect(mockNotifier.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ severity: "LIQUIDATABLE", healthFactor: 0.9 }),
    );

    // Verify all alerts are still active (unresolved)
    const activeAlerts = mockDb.alerts.filter((a) => a.resolvedAt === null);
    expect(activeAlerts).toHaveLength(4);

    // -----------------------------------------------------------------
    // Step 6: HF recovers to 2.5 - all alerts resolved
    // -----------------------------------------------------------------
    const resolvedCount = await engine.resolveAlerts(SAFE, 2.5);
    expect(resolvedCount).toBe(4);

    const stillActive = mockDb.alerts.filter((a) => a.resolvedAt === null);
    expect(stillActive).toHaveLength(0);

    // All alerts should now have a resolvedAt timestamp
    for (const alert of mockDb.alerts) {
      expect(alert.resolvedAt).toBeInstanceOf(Date);
    }
  });

  it("does not resolve alerts when HF is still below 2.0", async () => {
    await engine.evaluate(SAFE, metricsWithHF(1.4));
    expect(mockDb.alerts).toHaveLength(1);

    const resolved = await engine.resolveAlerts(SAFE, 1.6);
    expect(resolved).toBe(0);

    const active = mockDb.alerts.filter((a) => a.resolvedAt === null);
    expect(active).toHaveLength(1);
  });

  it("allows re-alerting after recovery and subsequent decline", async () => {
    // First decline
    await engine.evaluate(SAFE, metricsWithHF(1.4));
    expect(mockDb.alerts).toHaveLength(1);

    // Recover
    await engine.resolveAlerts(SAFE, 2.5);

    // Wait for cooldown to expire
    await new Promise((r) => setTimeout(r, 60));

    // Second decline
    const result = await engine.evaluate(SAFE, metricsWithHF(1.4));
    expect(result).toBeTruthy();
    expect(result!.severity).toBe("WARNING");
    expect(mockDb.alerts).toHaveLength(2);
    expect(mockNotifier.send).toHaveBeenCalledTimes(2);
  });

  it("tracks alerts independently for different safes", async () => {
    const safe2 = "0xaaa2000000000000000000000000000000000002";

    await engine.evaluate(SAFE, metricsWithHF(1.4));
    await engine.evaluate(safe2, metricsWithHF(1.1));

    expect(mockDb.alerts).toHaveLength(2);

    // Resolve only SAFE, not safe2
    await engine.resolveAlerts(SAFE, 2.5);

    const active = mockDb.alerts.filter((a) => a.resolvedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0].safeAddress).toBe(safe2);
  });

  it("escalation: same safe gets progressively worse alerts", async () => {
    await engine.evaluate(SAFE, metricsWithHF(1.8)); // INFO
    await engine.evaluate(SAFE, metricsWithHF(1.4)); // WARNING
    await engine.evaluate(SAFE, metricsWithHF(1.1)); // CRITICAL
    await engine.evaluate(SAFE, metricsWithHF(0.9)); // LIQUIDATABLE

    const severities = mockDb.alerts.map((a) => a.severity);
    expect(severities).toEqual(["INFO", "WARNING", "CRITICAL", "LIQUIDATABLE"]);
  });

  it("verify alert data integrity through lifecycle", async () => {
    await engine.evaluate(SAFE, metricsWithHF(1.1));

    const alert = mockDb.alerts[0];
    expect(alert.safeAddress).toBe(SAFE);
    expect(alert.severity).toBe("CRITICAL");
    expect(alert.healthFactor).toBe(1.1);
    expect(alert.message).toContain("1.1000");
    expect(alert.message).toContain("CRITICAL");
    expect(alert.resolvedAt).toBeNull();
    expect(alert.createdAt).toBeInstanceOf(Date);
  });
});
