import {
  pgTable,
  varchar,
  numeric,
  boolean,
  timestamp,
  bigserial,
  text,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// user_safes — all discovered user safes
// ---------------------------------------------------------------------------
export const userSafes = pgTable("user_safes", {
  address: varchar("address", { length: 42 }).primaryKey(),
  owner: varchar("owner", { length: 42 }),
  mode: varchar("mode", { length: 10 }),
  tier: varchar("tier", { length: 10 }),
  discoveredAt: timestamp("discovered_at").notNull().defaultNow(),
  lastPolledAt: timestamp("last_polled_at"),
  currentHealth: numeric("current_health", { precision: 20, scale: 6 }),
  totalCollateralUsd: numeric("total_collateral_usd", { precision: 20, scale: 6 }),
  totalDebtUsd: numeric("total_debt_usd", { precision: 20, scale: 6 }),
  isLiquidatable: boolean("is_liquidatable").default(false),
  hasDebt: boolean("has_debt").default(false),
});

// ---------------------------------------------------------------------------
// safe_snapshots — time-series health snapshots
// ---------------------------------------------------------------------------
export const safeSnapshots = pgTable(
  "safe_snapshots",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    safeAddress: varchar("safe_address", { length: 42 })
      .notNull()
      .references(() => userSafes.address),
    totalCollateralUsd: numeric("total_collateral_usd", {
      precision: 20,
      scale: 6,
    }),
    totalDebtUsd: numeric("total_debt_usd", { precision: 20, scale: 6 }),
    maxBorrowUsd: numeric("max_borrow_usd", { precision: 20, scale: 6 }),
    healthFactor: numeric("health_factor", { precision: 20, scale: 6 }),
    collateralDetails: jsonb("collateral_details"),
    debtDetails: jsonb("debt_details"),
    isLiquidatable: boolean("is_liquidatable").default(false),
    extraData: jsonb("extra_data"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    safeTimeIdx: index("idx_snapshots_safe_time").on(table.safeAddress, table.createdAt),
    healthIdx: index("idx_snapshots_health").on(table.healthFactor),
  }),
);

// ---------------------------------------------------------------------------
// alerts — health factor alerts
// ---------------------------------------------------------------------------
export const alerts = pgTable(
  "alerts",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    safeAddress: varchar("safe_address", { length: 42 })
      .notNull()
      .references(() => userSafes.address),
    severity: varchar("severity", { length: 20 }).notNull(),
    healthFactor: numeric("health_factor", { precision: 20, scale: 6 }),
    message: text("message"),
    details: jsonb("details"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    severityIdx: index("idx_alerts_severity").on(table.severity, table.createdAt),
    safeIdx: index("idx_alerts_safe").on(table.safeAddress, table.createdAt),
  }),
);

