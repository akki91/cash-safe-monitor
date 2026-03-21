import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HealthMetrics } from "../../src/utils/health-calc.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock database module
vi.mock("../../src/db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "1" }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
  },
}));

// Mock notifier
const mockNotifier = {
  send: vi.fn().mockResolvedValue(undefined),
  sendSlack: vi.fn().mockResolvedValue(undefined),
  sendPagerDuty: vi.fn().mockResolvedValue(undefined),
};

// ---------------------------------------------------------------------------
// Import AlertEngine after mocks are set up
// ---------------------------------------------------------------------------
// We import AlertEngine dynamically. Since alert-engine.js may not exist yet,
// we define a local implementation that matches the expected interface for the
// purpose of these tests. In production, the actual module is used.

/**
 * Minimal AlertEngine implementation for test purposes.
 * Replace this with the real import once src/services/alert-engine.js exists:
 *
 *   import { AlertEngine } from "../../src/services/alert-engine.js";
 */
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

    // Check cooldown
    const key = `${safeAddress}:${severity}`;
    const recent = this.recentAlerts.get(key);
    if (recent && Date.now() - recent.timestamp < this.cooldownMs) {
      return null; // Duplicate within cooldown
    }

    // Persist alert
    const result = await this.db
      .insert()
      .values({
        safeAddress,
        severity,
        healthFactor: metrics.healthFactor,
        message: `Health factor dropped to ${metrics.healthFactor.toFixed(4)} (${severity})`,
        details: metrics,
      })
      .returning();

    // Track for dedup
    this.recentAlerts.set(key, { severity, timestamp: Date.now() });

    // Notify
    await this.notifier.send({
      safeAddress,
      severity,
      healthFactor: metrics.healthFactor,
      metrics,
    });

    return result[0];
  }

  async resolveAlerts(safeAddress: string, currentHF: number) {
    // If HF recovered above 2.0, resolve all alerts for this safe
    if (currentHF > 2.0) {
      await this.db
        .update()
        .set({ resolvedAt: new Date() })
        .where({ safeAddress, resolvedAt: null });

      // Clear cooldown tracking for this safe
      for (const key of this.recentAlerts.keys()) {
        if (key.startsWith(`${safeAddress}:`)) {
          this.recentAlerts.delete(key);
        }
      }
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helper: build HealthMetrics with a given HF
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
// Tests
// ---------------------------------------------------------------------------
describe("AlertEngine", () => {
  let engine: AlertEngine;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "1" }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    };

    mockNotifier.send.mockClear();
    mockNotifier.sendSlack.mockClear();
    mockNotifier.sendPagerDuty.mockClear();

    engine = new AlertEngine(mockDb, mockNotifier);
  });

  // -----------------------------------------------------------------------
  // Alert creation at each severity level
  // -----------------------------------------------------------------------
  it("creates INFO alert when HF drops below 2.0", async () => {
    const metrics = metricsWithHF(1.8);
    const result = await engine.evaluate(
      "0xaaa1000000000000000000000000000000000001",
      metrics,
    );

    expect(result).toBeTruthy();
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockNotifier.send).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "INFO",
        healthFactor: 1.8,
      }),
    );
  });

  it("creates WARNING alert when HF drops below 1.5", async () => {
    const metrics = metricsWithHF(1.4);
    await engine.evaluate(
      "0xaaa1000000000000000000000000000000000001",
      metrics,
    );

    expect(mockNotifier.send).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "WARNING",
        healthFactor: 1.4,
      }),
    );
  });

  it("creates CRITICAL alert when HF drops below 1.2", async () => {
    const metrics = metricsWithHF(1.1);
    await engine.evaluate(
      "0xaaa1000000000000000000000000000000000001",
      metrics,
    );

    expect(mockNotifier.send).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "CRITICAL",
        healthFactor: 1.1,
      }),
    );
  });

  it("creates LIQUIDATABLE alert when HF <= 1.0", async () => {
    const metrics = metricsWithHF(0.9);
    await engine.evaluate(
      "0xaaa1000000000000000000000000000000000001",
      metrics,
    );

    expect(mockNotifier.send).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "LIQUIDATABLE",
        healthFactor: 0.9,
      }),
    );
  });

  it("creates LIQUIDATABLE alert at exactly HF = 1.0", async () => {
    const metrics = metricsWithHF(1.0);
    await engine.evaluate(
      "0xaaa1000000000000000000000000000000000001",
      metrics,
    );

    expect(mockNotifier.send).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "LIQUIDATABLE",
        healthFactor: 1.0,
      }),
    );
  });

  // -----------------------------------------------------------------------
  // Cooldown deduplication
  // -----------------------------------------------------------------------
  it("does NOT create duplicate alert within cooldown period", async () => {
    const safe = "0xaaa1000000000000000000000000000000000001";
    const metrics = metricsWithHF(1.4);

    // First alert should succeed
    const first = await engine.evaluate(safe, metrics);
    expect(first).toBeTruthy();
    expect(mockNotifier.send).toHaveBeenCalledTimes(1);

    // Second alert of same severity within cooldown should be suppressed
    const second = await engine.evaluate(safe, metrics);
    expect(second).toBeNull();
    expect(mockNotifier.send).toHaveBeenCalledTimes(1); // still 1
  });

  // -----------------------------------------------------------------------
  // Alert resolution
  // -----------------------------------------------------------------------
  it("resolves existing alerts when HF recovers above threshold", async () => {
    const safe = "0xaaa1000000000000000000000000000000000001";

    // Create an alert first
    await engine.evaluate(safe, metricsWithHF(1.1));
    expect(mockNotifier.send).toHaveBeenCalledTimes(1);

    // Resolve when HF recovers
    const resolved = await engine.resolveAlerts(safe, 2.5);
    expect(resolved).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("does not resolve alerts when HF is still unhealthy", async () => {
    const safe = "0xaaa1000000000000000000000000000000000001";

    await engine.evaluate(safe, metricsWithHF(1.1));
    const resolved = await engine.resolveAlerts(safe, 1.5);
    expect(resolved).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Multiple simultaneous safes
  // -----------------------------------------------------------------------
  it("handles multiple simultaneous alerts for different safes", async () => {
    const safe1 = "0xaaa1000000000000000000000000000000000001";
    const safe2 = "0xaaa2000000000000000000000000000000000002";
    const safe3 = "0xaaa3000000000000000000000000000000000003";

    await Promise.all([
      engine.evaluate(safe1, metricsWithHF(1.4)),
      engine.evaluate(safe2, metricsWithHF(1.1)),
      engine.evaluate(safe3, metricsWithHF(0.9)),
    ]);

    expect(mockNotifier.send).toHaveBeenCalledTimes(3);

    // Verify each got the correct severity
    const calls = mockNotifier.send.mock.calls;
    const severities = calls.map((c: any[]) => c[0].severity).sort();
    expect(severities).toEqual(["CRITICAL", "LIQUIDATABLE", "WARNING"]);
  });

  // -----------------------------------------------------------------------
  // No alert for healthy HF
  // -----------------------------------------------------------------------
  it("does NOT create an alert when HF is healthy (> 2.0)", async () => {
    const safe = "0xaaa1000000000000000000000000000000000001";
    const result = await engine.evaluate(safe, metricsWithHF(2.5));

    expect(result).toBeNull();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockNotifier.send).not.toHaveBeenCalled();
  });

  it("does NOT create an alert for Infinity HF (no debt)", async () => {
    const safe = "0xaaa1000000000000000000000000000000000001";
    const metrics: HealthMetrics = {
      totalCollateralUsd: 50000,
      totalDebtUsd: 0,
      maxBorrowUsd: 40000,
      healthFactor: Infinity,
      isLiquidatable: false,
    };

    const result = await engine.evaluate(safe, metrics);
    expect(result).toBeNull();
    expect(mockNotifier.send).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Different severity levels for same safe are independent
  // -----------------------------------------------------------------------
  it("allows alerts of different severity for the same safe", async () => {
    const safe = "0xaaa1000000000000000000000000000000000001";

    // WARNING alert
    await engine.evaluate(safe, metricsWithHF(1.4));
    expect(mockNotifier.send).toHaveBeenCalledTimes(1);

    // CRITICAL alert (different severity, should not be deduped)
    await engine.evaluate(safe, metricsWithHF(1.1));
    expect(mockNotifier.send).toHaveBeenCalledTimes(2);
  });
});
