import { describe, it, expect } from "vitest";
import {
  getHealthSeverity,
  getPollingInterval,
} from "../../src/utils/health-calc.js";

// ---------------------------------------------------------------------------
// getHealthSeverity
// ---------------------------------------------------------------------------
describe("getHealthSeverity", () => {
  it("returns HEALTHY for HF > 2.0", () => {
    expect(getHealthSeverity(2.5)).toBe("HEALTHY");
    expect(getHealthSeverity(3.0)).toBe("HEALTHY");
    expect(getHealthSeverity(100)).toBe("HEALTHY");
    expect(getHealthSeverity(Infinity)).toBe("HEALTHY");
  });

  it("returns INFO for HF in (1.5, 2.0]", () => {
    expect(getHealthSeverity(2.0)).toBe("INFO");
    expect(getHealthSeverity(1.8)).toBe("INFO");
    expect(getHealthSeverity(1.51)).toBe("INFO");
  });

  it("returns WARNING for HF in (1.2, 1.5]", () => {
    expect(getHealthSeverity(1.5)).toBe("WARNING");
    expect(getHealthSeverity(1.3)).toBe("WARNING");
    expect(getHealthSeverity(1.21)).toBe("WARNING");
  });

  it("returns CRITICAL for HF in (1.0, 1.2]", () => {
    expect(getHealthSeverity(1.2)).toBe("CRITICAL");
    expect(getHealthSeverity(1.1)).toBe("CRITICAL");
    expect(getHealthSeverity(1.01)).toBe("CRITICAL");
  });

  it("returns LIQUIDATABLE for HF <= 1.0", () => {
    expect(getHealthSeverity(1.0)).toBe("LIQUIDATABLE");
    expect(getHealthSeverity(0.9)).toBe("LIQUIDATABLE");
    expect(getHealthSeverity(0.5)).toBe("LIQUIDATABLE");
    expect(getHealthSeverity(0)).toBe("LIQUIDATABLE");
  });

  it("returns HEALTHY for exactly 2.01", () => {
    expect(getHealthSeverity(2.01)).toBe("HEALTHY");
  });
});

// ---------------------------------------------------------------------------
// getPollingInterval
// ---------------------------------------------------------------------------
describe("getPollingInterval", () => {
  it("returns 15 minutes (900000 ms) for Infinity (no debt)", () => {
    expect(getPollingInterval(Infinity)).toBe(900_000);
  });

  it("returns 5 minutes (300000 ms) for HF > 2.0", () => {
    expect(getPollingInterval(2.5)).toBe(300_000);
    expect(getPollingInterval(3.0)).toBe(300_000);
    expect(getPollingInterval(10)).toBe(300_000);
  });

  it("returns 2 minutes (120000 ms) for HF in (1.5, 2.0]", () => {
    expect(getPollingInterval(2.0)).toBe(120_000);
    expect(getPollingInterval(1.8)).toBe(120_000);
    expect(getPollingInterval(1.51)).toBe(120_000);
  });

  it("returns 30 seconds (30000 ms) for HF in (1.2, 1.5]", () => {
    expect(getPollingInterval(1.5)).toBe(30_000);
    expect(getPollingInterval(1.3)).toBe(30_000);
    expect(getPollingInterval(1.21)).toBe(30_000);
  });

  it("returns 10 seconds (10000 ms) for HF <= 1.2", () => {
    expect(getPollingInterval(1.2)).toBe(10_000);
    expect(getPollingInterval(1.1)).toBe(10_000);
    expect(getPollingInterval(1.0)).toBe(10_000);
  });

  it("returns 10 seconds (10000 ms) for HF <= 1.0 (liquidatable)", () => {
    expect(getPollingInterval(0.9)).toBe(10_000);
    expect(getPollingInterval(0.5)).toBe(10_000);
    expect(getPollingInterval(0)).toBe(10_000);
  });
});
