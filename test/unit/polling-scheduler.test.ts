import { describe, it, expect } from "vitest";
import { getPollingInterval } from "../../src/utils/health-calc.js";

// ---------------------------------------------------------------------------
// Polling interval logic
//
// From the design doc:
//   HF = Infinity (no debt)  -> 15 min  (900,000 ms)
//   HF > 2.0                 ->  5 min  (300,000 ms)
//   1.5 < HF <= 2.0          ->  2 min  (120,000 ms)
//   1.2 < HF <= 1.5          -> 30 sec  ( 30,000 ms)
//   HF <= 1.2                -> 10 sec  ( 10,000 ms)
// ---------------------------------------------------------------------------
describe("Polling Scheduler - getPollingInterval", () => {
  // -----------------------------------------------------------------------
  // Infinity (no debt)
  // -----------------------------------------------------------------------
  it("returns 15 minutes for Infinity (no debt)", () => {
    expect(getPollingInterval(Infinity)).toBe(900_000);
  });

  // -----------------------------------------------------------------------
  // HF > 2.0 — healthy, low risk
  // -----------------------------------------------------------------------
  it("returns 5 minutes for HF > 2.0", () => {
    expect(getPollingInterval(2.01)).toBe(300_000);
    expect(getPollingInterval(2.5)).toBe(300_000);
    expect(getPollingInterval(5.0)).toBe(300_000);
    expect(getPollingInterval(50)).toBe(300_000);
  });

  // -----------------------------------------------------------------------
  // 1.5 < HF <= 2.0 — moderate risk
  // -----------------------------------------------------------------------
  it("returns 2 minutes for HF 1.5-2.0", () => {
    expect(getPollingInterval(2.0)).toBe(120_000);
    expect(getPollingInterval(1.75)).toBe(120_000);
    expect(getPollingInterval(1.51)).toBe(120_000);
  });

  // -----------------------------------------------------------------------
  // 1.2 < HF <= 1.5 — high risk, approaching danger
  // -----------------------------------------------------------------------
  it("returns 30 seconds for HF 1.2-1.5", () => {
    expect(getPollingInterval(1.5)).toBe(30_000);
    expect(getPollingInterval(1.35)).toBe(30_000);
    expect(getPollingInterval(1.21)).toBe(30_000);
  });

  // -----------------------------------------------------------------------
  // HF <= 1.2 — critical, near liquidation
  // -----------------------------------------------------------------------
  it("returns 10 seconds for HF <= 1.2", () => {
    expect(getPollingInterval(1.2)).toBe(10_000);
    expect(getPollingInterval(1.15)).toBe(10_000);
    expect(getPollingInterval(1.05)).toBe(10_000);
    expect(getPollingInterval(1.01)).toBe(10_000);
  });

  // -----------------------------------------------------------------------
  // HF <= 1.0 — liquidatable
  // -----------------------------------------------------------------------
  it("returns 10 seconds for HF <= 1.0", () => {
    expect(getPollingInterval(1.0)).toBe(10_000);
    expect(getPollingInterval(0.95)).toBe(10_000);
    expect(getPollingInterval(0.5)).toBe(10_000);
    expect(getPollingInterval(0.1)).toBe(10_000);
    expect(getPollingInterval(0)).toBe(10_000);
  });

  // -----------------------------------------------------------------------
  // Boundary transitions
  // -----------------------------------------------------------------------
  it("correctly differentiates boundary values", () => {
    // Just above 2.0 vs exactly 2.0
    expect(getPollingInterval(2.001)).toBe(300_000); // 5 min
    expect(getPollingInterval(2.0)).toBe(120_000); // 2 min

    // Just above 1.5 vs exactly 1.5
    expect(getPollingInterval(1.501)).toBe(120_000); // 2 min
    expect(getPollingInterval(1.5)).toBe(30_000); // 30 sec

    // Just above 1.2 vs exactly 1.2
    expect(getPollingInterval(1.201)).toBe(30_000); // 30 sec
    expect(getPollingInterval(1.2)).toBe(10_000); // 10 sec
  });
});
