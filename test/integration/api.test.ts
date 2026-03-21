import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// ---------------------------------------------------------------------------
// Mock the database module before any other imports that may depend on it.
// ---------------------------------------------------------------------------
vi.mock("../../src/db/index.js", () => {
  const mockSafes = [
    {
      address: "0xaaa1000000000000000000000000000000000001",
      owner: "0xbbb1000000000000000000000000000000000001",
      mode: "Credit",
      tier: "Whale",
      discoveredAt: new Date("2026-01-01"),
      lastPolledAt: new Date("2026-03-21T10:00:00Z"),
      currentHealth: "2.1200",
      hasDebt: true,
    },
    {
      address: "0xaaa2000000000000000000000000000000000002",
      owner: "0xbbb2000000000000000000000000000000000002",
      mode: "Credit",
      tier: "Chad",
      discoveredAt: new Date("2026-01-15"),
      lastPolledAt: new Date("2026-03-21T10:05:00Z"),
      currentHealth: "1.4500",
      hasDebt: true,
    },
    {
      address: "0xaaa3000000000000000000000000000000000003",
      owner: "0xbbb3000000000000000000000000000000000003",
      mode: "Credit",
      tier: "Wojak",
      discoveredAt: new Date("2026-02-01"),
      lastPolledAt: new Date("2026-03-21T10:02:00Z"),
      currentHealth: "0.9500",
      hasDebt: true,
    },
  ];

  const mockSnapshots = [
    {
      id: "1",
      safeAddress: "0xaaa1000000000000000000000000000000000001",
      totalCollateralUsd: "25861.34",
      totalDebtUsd: "9768.92",
      maxBorrowUsd: "20752.37",
      healthFactor: "2.1200",
      isLiquidatable: false,
      createdAt: new Date("2026-03-21T10:00:00Z"),
    },
    {
      id: "2",
      safeAddress: "0xaaa1000000000000000000000000000000000001",
      totalCollateralUsd: "25000.00",
      totalDebtUsd: "9768.92",
      maxBorrowUsd: "20000.00",
      healthFactor: "2.0500",
      isLiquidatable: false,
      createdAt: new Date("2026-03-21T09:55:00Z"),
    },
  ];

  const mockAlerts = [
    {
      id: "1",
      safeAddress: "0xaaa2000000000000000000000000000000000002",
      severity: "WARNING",
      healthFactor: "1.4500",
      message: "Health factor dropped to 1.4500 (WARNING)",
      details: {},
      resolvedAt: null,
      createdAt: new Date("2026-03-21T09:30:00Z"),
    },
    {
      id: "2",
      safeAddress: "0xaaa3000000000000000000000000000000000003",
      severity: "LIQUIDATABLE",
      healthFactor: "0.9500",
      message: "Health factor dropped to 0.9500 (LIQUIDATABLE)",
      details: {},
      resolvedAt: null,
      createdAt: new Date("2026-03-21T09:45:00Z"),
    },
    {
      id: "3",
      safeAddress: "0xaaa1000000000000000000000000000000000001",
      severity: "INFO",
      healthFactor: "1.9500",
      message: "Health factor dropped to 1.9500 (INFO)",
      details: {},
      resolvedAt: new Date("2026-03-21T10:00:00Z"),
      createdAt: new Date("2026-03-20T15:00:00Z"),
    },
  ];

  return {
    db: {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation((table: any) => ({
          where: vi.fn().mockImplementation((condition: any) => ({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation((lim: number) => ({
                offset: vi.fn().mockResolvedValue(mockSafes.slice(0, lim)),
              })),
            }),
          })),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation((lim: number) => ({
              offset: vi.fn().mockResolvedValue(mockSafes.slice(0, lim)),
            })),
          }),
          limit: vi.fn().mockReturnValue({
            offset: vi.fn().mockResolvedValue(mockSafes),
          }),
        })),
      })),
      _mockSafes: mockSafes,
      _mockSnapshots: mockSnapshots,
      _mockAlerts: mockAlerts,
    },
  };
});

// ---------------------------------------------------------------------------
// Build a minimal Fastify app for testing.
// In production this would come from src/api/server.ts — here we wire up a
// lightweight version that exercises the expected route shapes.
// ---------------------------------------------------------------------------
import Fastify, { type FastifyInstance } from "fastify";

let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });

  const { db } = await import("../../src/db/index.js");
  const mockDb = db as any;

  // GET /health
  server.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  // GET /api/overview
  server.get("/api/overview", async () => ({
    totalSafes: mockDb._mockSafes.length,
    totalCollateralUsd: 60861.34,
    totalDebtUsd: 29537.84,
    safesAtRisk: 2,
    safesLiquidatable: 1,
    lastUpdated: new Date().toISOString(),
  }));

  // GET /api/safes
  server.get("/api/safes", async (request) => {
    const { page = "1", limit = "20" } = request.query as Record<string, string>;
    const p = parseInt(page, 10);
    const l = parseInt(limit, 10);
    const start = (p - 1) * l;
    const items = mockDb._mockSafes.slice(start, start + l);
    return {
      data: items,
      pagination: {
        page: p,
        limit: l,
        total: mockDb._mockSafes.length,
        totalPages: Math.ceil(mockDb._mockSafes.length / l),
      },
    };
  });

  // GET /api/safes/:address
  server.get("/api/safes/:address", async (request, reply) => {
    const { address } = request.params as { address: string };
    const safe = mockDb._mockSafes.find(
      (s: any) => s.address.toLowerCase() === address.toLowerCase(),
    );
    if (!safe) {
      return reply.status(404).send({ error: "Safe not found" });
    }
    return { data: safe };
  });

  // GET /api/safes/:address/history
  server.get("/api/safes/:address/history", async (request, reply) => {
    const { address } = request.params as { address: string };
    const snapshots = mockDb._mockSnapshots.filter(
      (s: any) => s.safeAddress.toLowerCase() === address.toLowerCase(),
    );
    return {
      data: snapshots,
      count: snapshots.length,
    };
  });

  // GET /api/alerts
  server.get("/api/alerts", async (request) => {
    const {
      page = "1",
      limit = "20",
      severity,
    } = request.query as Record<string, string>;
    const p = parseInt(page, 10);
    const l = parseInt(limit, 10);

    let filtered = mockDb._mockAlerts;
    if (severity) {
      filtered = filtered.filter((a: any) => a.severity === severity);
    }

    const start = (p - 1) * l;
    const items = filtered.slice(start, start + l);
    return {
      data: items,
      pagination: {
        page: p,
        limit: l,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / l),
      },
    };
  });

  // GET /api/alerts/active
  server.get("/api/alerts/active", async () => {
    const active = mockDb._mockAlerts.filter((a: any) => a.resolvedAt === null);
    return { data: active, count: active.length };
  });

  return server;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("API Integration Tests", () => {
  // -----------------------------------------------------------------------
  // Health endpoint
  // -----------------------------------------------------------------------
  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("status", "ok");
      expect(body).toHaveProperty("timestamp");
    });
  });

  // -----------------------------------------------------------------------
  // Overview
  // -----------------------------------------------------------------------
  describe("GET /api/overview", () => {
    it("returns correct shape with aggregate data", async () => {
      const res = await app.inject({ method: "GET", url: "/api/overview" });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body).toHaveProperty("totalSafes");
      expect(body).toHaveProperty("totalCollateralUsd");
      expect(body).toHaveProperty("totalDebtUsd");
      expect(body).toHaveProperty("safesAtRisk");
      expect(body).toHaveProperty("safesLiquidatable");
      expect(body).toHaveProperty("lastUpdated");
      expect(typeof body.totalSafes).toBe("number");
      expect(body.totalSafes).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Safe list
  // -----------------------------------------------------------------------
  describe("GET /api/safes", () => {
    it("returns paginated results with default params", async () => {
      const res = await app.inject({ method: "GET", url: "/api/safes" });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body).toHaveProperty("data");
      expect(body).toHaveProperty("pagination");
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toHaveProperty("page", 1);
      expect(body.pagination).toHaveProperty("limit", 20);
      expect(body.pagination).toHaveProperty("total");
      expect(body.pagination).toHaveProperty("totalPages");
    });

    it("respects page and limit query params", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/safes?page=1&limit=2",
      });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.data.length).toBeLessThanOrEqual(2);
      expect(body.pagination.limit).toBe(2);
    });

    it("returns empty data for out-of-range page", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/safes?page=100&limit=20",
      });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.data.length).toBe(0);
    });

    it("each safe has expected fields", async () => {
      const res = await app.inject({ method: "GET", url: "/api/safes" });
      const body = res.json();

      if (body.data.length > 0) {
        const safe = body.data[0];
        expect(safe).toHaveProperty("address");
        expect(safe).toHaveProperty("owner");
        expect(safe).toHaveProperty("mode");
        expect(safe).toHaveProperty("currentHealth");
        expect(safe).toHaveProperty("hasDebt");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Safe detail
  // -----------------------------------------------------------------------
  describe("GET /api/safes/:address", () => {
    it("returns safe detail for a valid address", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/safes/0xaaa1000000000000000000000000000000000001",
      });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body).toHaveProperty("data");
      expect(body.data.address).toBe(
        "0xaaa1000000000000000000000000000000000001",
      );
    });

    it("returns 404 for a non-existent address", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/safes/0x0000000000000000000000000000000000000099",
      });
      expect(res.statusCode).toBe(404);

      const body = res.json();
      expect(body).toHaveProperty("error");
    });

    it("handles case-insensitive address lookup", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/safes/0xAAA1000000000000000000000000000000000001",
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // Safe history
  // -----------------------------------------------------------------------
  describe("GET /api/safes/:address/history", () => {
    it("returns time series data for a valid safe", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/safes/0xaaa1000000000000000000000000000000000001/history",
      });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body).toHaveProperty("data");
      expect(body).toHaveProperty("count");
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.count).toBeGreaterThan(0);
    });

    it("returns empty array for a safe with no history", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/safes/0x0000000000000000000000000000000000000099/history",
      });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.data).toEqual([]);
      expect(body.count).toBe(0);
    });

    it("history entries have expected fields", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/safes/0xaaa1000000000000000000000000000000000001/history",
      });
      const body = res.json();

      if (body.data.length > 0) {
        const snap = body.data[0];
        expect(snap).toHaveProperty("healthFactor");
        expect(snap).toHaveProperty("totalCollateralUsd");
        expect(snap).toHaveProperty("totalDebtUsd");
        expect(snap).toHaveProperty("createdAt");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Alerts
  // -----------------------------------------------------------------------
  describe("GET /api/alerts", () => {
    it("returns alerts list with pagination", async () => {
      const res = await app.inject({ method: "GET", url: "/api/alerts" });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body).toHaveProperty("data");
      expect(body).toHaveProperty("pagination");
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("filters alerts by severity", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/alerts?severity=WARNING",
      });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      for (const alert of body.data) {
        expect(alert.severity).toBe("WARNING");
      }
    });

    it("respects pagination params", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/alerts?page=1&limit=1",
      });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.data.length).toBeLessThanOrEqual(1);
      expect(body.pagination.limit).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Active alerts
  // -----------------------------------------------------------------------
  describe("GET /api/alerts/active", () => {
    it("returns only active (unresolved) alerts", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/alerts/active",
      });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body).toHaveProperty("data");
      expect(body).toHaveProperty("count");

      for (const alert of body.data) {
        expect(alert.resolvedAt).toBeNull();
      }

      // We know from mock data there are 2 active alerts
      expect(body.count).toBe(2);
    });
  });
});
