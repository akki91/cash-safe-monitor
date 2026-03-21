# Cash Safe LTV Health Monitoring System - Design Document

## 1. Problem Statement

ether.fi needs a monitoring system to track the health of **all user safes** in near-time (every x internal - configurable). Each safe holds collateral assets (liquidUSD, USDC, liquidETH, etc.) against which users borrow USDC. If a user's borrow exceeds the liquidation threshold, their assets can be liquidated.

**Core monitoring needs:**
- Discover all user safes (no on-chain registry exists — must index events)
- Continuously compute health factors for every safe
- Alert when safes approach or breach liquidation thresholds
- Provide a dashboard for the ether.fi operations team
- Track aggregate protocol-level risk metrics

---

## 2. Key Domain Concepts

### Health Factor Formula
```
Health Factor = Max Borrow Capacity / Total Borrowings

Where:
  Max Borrow Capacity and Total Borrowings are returned directly
  by the CashLens contract (getSafeCashData)

Health Factor > 1.0  → Healthy
Health Factor ≤ 1.0  → Liquidatable
```

#### Severity Ranges

The system classifies each safe into a severity tier based on its health factor. These ranges drive alerting thresholds, dashboard colour-coding, and Prometheus gauge labels:

| Health Factor Range | Severity | Colour |
|---------------------|----------|--------|
| HF > 2.0 or Infinity (no debt) | **HEALTHY** | Green |
| 1.5 < HF ≤ 2.0 | **INFO** | Yellow |
| 1.2 < HF ≤ 1.5 | **WARNING** | Orange |
| 1.0 < HF ≤ 1.2 | **CRITICAL** | Red |
| HF ≤ 1.0 | **LIQUIDATABLE** | Red (flashing) |

These thresholds are defined in `src/utils/health-calc.ts` (`getHealthSeverity()`) and used consistently across the alert engine, health poller distribution tracking, and dashboard UI.

### Data Source

The system obtains all health data from a single on-chain source: the **CashLens** contract (`0x7DA874f3BacA1A8F0af27E5ceE1b8C66A772F84E`). A single `getSafeCashData(address, address[])` call returns everything needed per safe:

- `totalCollateralInUsd` — aggregate collateral value
- `totalBorrowInUsd` — aggregate debt value
- `maxBorrowInUsd` — maximum borrow capacity (used for HF calculation)
- `collateralBalances[]` — per-token collateral positions with balances
- `borrows[]` — per-token debt positions
- `tokenPrices[]` — USD prices for all tokens
- `mode` — Credit (0) or Debit (1)
- `isLiquidatable` — derived from `totalBorrow > 0 && maxBorrow <= totalBorrow`

This single-call approach eliminates the need for separate contract calls for prices, debt details, or collateral configs.

### Example
| Asset      | Balance   | USD Value  |
|------------|-----------|------------|
| liquidUSD  | 18,717.34 | $16,952.98 |
| USDC       | 7,321.69  | $6,589.52  |
| liquidETH  | 1.34      | $2,318.84  |

- Total Collateral = **$25,861.34**
- Max Borrow = **$20,752.37** (returned by CashLens)
- Borrowed = $9,768.92
- Health Factor = 20,752.37 / 9,768.92 = **2.12** (healthy)

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA INGESTION LAYER                         │
│                                                                     │
│  ┌──────────────┐  ┌──────────────────┐                            │
│  │  CSV Loader   │  │  Periodic RPC    │                            │
│  │ (Load safe    │  │  Poller          │                            │
│  │  addresses    │  │ (CashLens        │                            │
│  │  from file    │  │  .getSafeCash    │                            │
│  │  at startup)  │  │  Data())         │                            │
│  └──────┬───────┘  └────────┬─────────┘                            │
│         │                   │                                       │
└─────────┼───────────────────┼───────────────────────────────────────┘
          │                   │
          ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        COMPUTE / STORAGE LAYER                      │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     PostgreSQL Database                       │   │
│  │  - user_safes (address, owner, mode, discovered_at)          │   │
│  │  - safe_snapshots (safe_addr, collateral[], debt, health,    │   │
│  │                     max_borrow, timestamp)                   │   │
│  │  - alerts (safe_addr, type, severity, health_factor, ts)     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐                        │
│  │  Health Engine    │  │  Alert Engine     │                       │
│  │  (Computes HF    │  │  (Threshold-based │                       │
│  │   from CashLens  │  │   alerting with   │                       │
│  │   data each      │  │   deduplication)  │                       │
│  │   poll cycle)    │  │                   │                       │
│  └──────────────────┘  └──────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
          │                                       │
          ▼                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       PRESENTATION LAYER                            │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  REST API         │  │  Dashboard   │  │  Notification         │ │
│  │  (Safe list,      │  │  (React SPA) │  │  Service              │ │
│  │   health data,    │  │              │  │  (Slack / PagerDuty / │ │
│  │   history,        │  │              │  │   Telegram / Webhook) │ │
│  │   alerts)         │  │              │  │                       │ │
│  └──────────────────┘  └──────────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Tech Stack & Rationale

| Component | Choice | Why |
|-----------|--------|-----|
| **Language** | TypeScript (Node.js) | Native viem ecosystem; fast prototyping; type-safe contract interactions |
| **Blockchain Library** | **viem** | Modern, type-safe, tree-shakeable; built-in ABI typing; first-class multicall support |
| **Database** | **PostgreSQL** | Time-series queries for health history; JSONB for flexible collateral arrays; battle-tested; great indexing for range queries on health factors |
| **ORM** | **Drizzle ORM** | Lightweight, type-safe, SQL-first; minimal overhead vs Prisma; great for this scale |
| **Backend Framework** | **Fastify** | 2-3x faster than Express; schema-based validation; native TypeScript; WebSocket support for live updates |
| **Frontend** | **React + Vite + Recharts** | Fast to build; Recharts for health factor charts; TailwindCSS for rapid UI |
| **Job Scheduler** | **BullMQ** (Redis-backed) | Reliable cron-like polling; retries; concurrency control; rate limiting for RPC calls |
| **Containerization** | **Docker Compose** | Single `docker compose up` for reviewer; bundles Postgres + Redis + App |
| **Testing** | **Vitest** (unit + integration) + **JMeter** (perf) | Fast test runner; native ESM; Fastify's built-in `app.inject()` for API tests |

### Why NOT other choices?

| Alternative | Rejected Because |
|-------------|-----------------|
| **Python** | Weaker Ethereum library ecosystem for typed contract interactions; slower for real-time WebSocket processing |
| **The Graph (subgraph)** | External dependency; slower iteration for custom health logic; can't do push-based alerting natively |
| **MongoDB** | Relational queries (JOIN safe + collateral + debt) are core; time-series in Postgres is sufficient |
| **Prisma** | Heavier; Drizzle is better for raw SQL needs and lighter footprint |
| **Express** | Slower; no built-in schema validation; Fastify is strictly better for this use case |

---

## 5. Component Design

### 5.1 Safe Address Loading (CSV)

**Problem:** There is no on-chain enumeration of user safes. `CashDataProvider` only stores a whitelist mapping (`address → bool`), not a list.

**Current Solution:** Safe addresses are loaded from a CSV file at startup. This is the simplest approach for the initial deployment where the ether.fi team provides a known list of safe addresses.

```
Startup Flow:
┌─────────────────────────────────────────────────────┐
│  1. READ CSV FILE (SAFE_ADDRESSES_CSV env var)      │
│     - Expects header row with "address" column      │
│     - Reads line-by-line using Node.js readline     │
│     - Validates each address (0x + 40 hex chars)    │
│                                                     │
│  2. BULK INSERT INTO DATABASE                       │
│     - Batches of 1,000 rows with onConflictDoNothing│
│     - Logs progress every 10,000 addresses          │
│     - Handles 450K+ addresses efficiently           │
│                                                     │
│  3. CONTINUE WITH EXISTING SAFES ON ERROR           │
│     - If CSV not found or malformed, logs error     │
│     - Falls back to whatever is already in the DB   │
└─────────────────────────────────────────────────────┘
```

**How the CSV was populated:** The initial CSV was generated using the `scroll.logs` datasource on Dune Analytics to find borrow events emitted by the ether.fi Cash protocol. The approach is inspired by [this Dune query](https://dune.com/queries/4532934/7566624). The user safe addresses were extracted from these log entries, giving us a set of safes that have actively borrowed (and therefore have meaningful health factors to monitor).

**Why CSV?**
- Simple, no external API dependencies
- The ether.fi team can provide addresses directly or the list can be refreshed from on-chain event data
- Handles large address lists (450K+) with streaming reads
- Idempotent — safe to re-run with updated CSVs

#### Future: Safe Discovery Strategies

When fully autonomous discovery is needed, the following approaches are planned:

| Strategy | Speed | Trustless | Dependency |
|----------|-------|-----------|------------|
| **Dune API bootstrap** | ~5 sec | No (off-chain index) | Dune API key |
| **On-chain event scan** | ~30 min | Yes (on-chain) | RPC only |
| **Live WebSocket watch** | Real-time | Yes | WebSocket RPC |

- **Dune API:** Query #5235398 ("ether.fi Cash User Safes") returns all known safe addresses via REST API in seconds. Would be the preferred bootstrap strategy.
- **Historical event scan:** Scan `UserSafeFactory` for `UserSafeCreated` events in 10,000-block chunks. Slower but fully trustless — no external API dependency.
- **Live WebSocket watch:** Subscribe to new `UserSafeCreated` events for ongoing discovery after initial bootstrap. Catches safes created after startup.

All strategies would use idempotent upserts (`onConflictDoNothing`), so they can safely overlap. The ether.fi team would provide addresses directly, or an API endpoint could replace the CSV approach.

### 5.2 Health Polling Service

**Core loop** (runs every N seconds via BullMQ):

```typescript
async function pollSafeHealth(safeAddress: string) {
  // 1. Call CashLens.getSafeCashData(safeAddress, []) via multicall
  const data = await lensContract.read.getSafeCashData([safeAddress, []]);

  // 2. Extract values from the response
  const totalCollateralUsd = Number(data.totalCollateralInUsd) / 1e6;
  const totalDebtUsd = Number(data.totalBorrowInUsd) / 1e6;
  const maxBorrowUsd = Number(data.maxBorrowInUsd) / 1e6;

  // 3. Compute health factor
  const healthFactor = totalDebtUsd > 0 ? maxBorrowUsd / totalDebtUsd : Infinity;
  const isLiquidatable = totalDebtUsd > 0 && maxBorrowUsd <= totalDebtUsd;

  // 4. Resolve token symbols via ERC20 multicall (cached)
  const symbols = await resolveTokenSymbols(tokenAddresses);

  // 5. Persist snapshot
  await db.insert(safeSnapshots).values({ ... });

  // 6. Evaluate alerts
  await alertEngine.evaluate(safeAddress, metrics);
}
```

**Current Implementation:** All safes are polled together in a single batch on a fixed interval controlled by the `POLL_INTERVAL_MS` environment variable (default: 30 seconds). The `HealthPollerService.schedulePollCycle()` method runs one full round — fetching data for every known safe via multicall, persisting snapshots, evaluating alerts, and broadcasting WebSocket updates — then waits `POLL_INTERVAL_MS` before starting the next round.

**Single-Call Architecture:** Each safe requires only 1 RPC call (`getSafeCashData`) which returns all collateral balances, debt positions, token prices, and aggregate USD values. Token symbols are resolved separately via ERC20 `symbol()` calls with an in-memory cache, so they only need to be fetched once per token address.

**Batching with Multicall:** viem's `multicall` batches multiple safe reads into a single RPC call (up to `MULTICALL_BATCH_SIZE` safes per call, default 100), dramatically reducing RPC overhead.

> **Note:** A `getPollingInterval()` utility function exists in `src/utils/health-calc.ts` that maps health factor ranges to per-safe polling intervals, but it is **not currently wired up** — see [Section 15: Future Improvements](#15-future-improvements) for the adaptive polling design.

### 5.3 Alert Engine

**Alert Levels:**
| Level | Condition | Action |
|-------|-----------|--------|
| **INFO** | HF drops below 2.0 | Log; dashboard indicator turns yellow |
| **WARNING** | HF drops below 1.5 | Slack notification; dashboard turns orange |
| **CRITICAL** | HF drops below 1.2 | PagerDuty/Telegram alert; dashboard turns red |
| **LIQUIDATABLE** | HF ≤ 1.0 (debt > max borrow) | Immediate alert; auto-triggers monitoring escalation |

**Deduplication:** Don't re-alert for same safe at same level within a configurable cooldown window (e.g., 15 min).

**Alert payload:**
```json
{
  "safe_address": "0x...",
  "health_factor": 1.15,
  "total_collateral_usd": 25861.34,
  "total_debt_usd": 19500.00,
  "max_borrow_usd": 22445.00,
  "assets": [
    { "token": "liquidUSD", "balance": 18717.34, "value_usd": 16952.98 },
    { "token": "USDC", "balance": 7321.69, "value_usd": 6589.52 }
  ],
  "severity": "CRITICAL",
  "timestamp": "2026-03-21T10:30:00Z"
}
```

### 5.4 REST API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/safes` | List all safes with current health (paginated, filterable by health range) |
| GET | `/api/safes/:address` | Detailed safe data + health history |
| GET | `/api/safes/:address/history` | Health factor time-series for charting |
| GET | `/api/overview` | Aggregate stats: total safes, total collateral, total debt, safes at risk |
| GET | `/api/alerts` | Recent alerts (filterable by severity) |
| GET | `/api/alerts/active` | Currently active (unresolved) alerts |
| WS  | `/ws/health` | Real-time health factor updates (WebSocket) |

### 5.5 Dashboard (React SPA)

**Views:**

1. **Overview Page**
   - Total safes monitored, total collateral TVL, total outstanding debt
   - Distribution histogram of health factors (how many safes in each bucket)
   - Safes at risk count (HF < 1.5) with trend

2. **Safe List Page**
   - Sortable/filterable table: address, collateral, debt, HF, mode
   - Color-coded health: green (>2.0), yellow (1.5-2.0), orange (1.2-1.5), red (<1.2)
   - Quick filters: "At Risk", "Liquidatable", "All"

3. **Safe Detail Page**
   - Health factor gauge visualization
   - Collateral breakdown with token symbols
   - Health factor history (line chart over time)
   - Debt details

4. **Alerts Page**
   - Alert feed with severity badges
   - Alert history with resolution status

---

## 6. Database Schema

```sql
-- All discovered user safes
CREATE TABLE user_safes (
    address         VARCHAR(42) PRIMARY KEY,
    owner           VARCHAR(42),
    mode            VARCHAR(10),  -- 'Credit' | 'Debit'
    tier            VARCHAR(10),
    discovered_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    last_polled_at  TIMESTAMP,
    current_health  DECIMAL(20, 6),
    has_debt        BOOLEAN DEFAULT FALSE
);

-- Time-series health snapshots
CREATE TABLE safe_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    safe_address    VARCHAR(42) NOT NULL REFERENCES user_safes(address),
    total_collateral_usd  DECIMAL(20, 6),
    total_debt_usd        DECIMAL(20, 6),
    max_borrow_usd        DECIMAL(20, 6),
    health_factor         DECIMAL(20, 6),
    collateral_details    JSONB,  -- [{token, symbol, balance, value_usd}]
    debt_details          JSONB,  -- [{token, symbol, amount, value_usd}]
    is_liquidatable       BOOLEAN DEFAULT FALSE,
    created_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_snapshots_safe_time ON safe_snapshots(safe_address, created_at DESC);
CREATE INDEX idx_snapshots_health ON safe_snapshots(health_factor);

-- Alerts
CREATE TABLE alerts (
    id              BIGSERIAL PRIMARY KEY,
    safe_address    VARCHAR(42) NOT NULL REFERENCES user_safes(address),
    severity        VARCHAR(20) NOT NULL,  -- INFO | WARNING | CRITICAL | LIQUIDATABLE
    health_factor   DECIMAL(20, 6),
    message         TEXT,
    details         JSONB,
    resolved_at     TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_severity ON alerts(severity, created_at DESC);
CREATE INDEX idx_alerts_safe ON alerts(safe_address, created_at DESC);
```

---

## 7. Data Flow

```
┌──────────────┐
│  CSV File    │   safe_addresses.csv (populated from
│  (Dune       │   scroll.logs borrow events via Dune)
│   export)    │
└──────┬───────┘
       │  startup: bulk insert
       ▼
┌──────────────┐                             ┌──────────────┐
│  PostgreSQL  │                             │  Ethereum    │
│  Database    │                             │  Node (RPC)  │
│              │◄────────────────────────────│  (Ankr /     │
└──────┬───────┘  multicall (batched reads)  │   Alchemy)   │
       │          CashLens.getSafeCashData() └──────────────┘
       │          ERC20.symbol() (cached)           │
       │          + retry w/ exponential backoff    │
       │                                            │
       ▼                                            │
┌──────────────┐                                    │
│  Health      │ ◄──────────────────────────────────┘
│  Polling     │
│  Service     │ ──── compute + store ─────┐
│  (BullMQ)    │                           │
└──────────────┘                           ▼
                                    ┌──────────────┐
                                    │  Alert       │
                                    │  Engine      │
                                    └──────┬───────┘
                                           │
                                           ▼
                                    ┌──────────────┐
                                    │  Slack /     │
                                    │  PagerDuty / │
                                    │  Webhook     │
                                    └──────────────┘
```

---

## 8. Test Plan

### 8.1 Unit Tests (Vitest)

| Test Area | Test Cases | Priority |
|-----------|------------|----------|
| **Health Severity Classification** | Correct severity at each threshold (2.0, 1.5, 1.2, 1.0) | P0 |
| | HF = Infinity → HEALTHY | P0 |
| | Boundary values (exactly 2.0, 1.5, 1.2, 1.0) | P0 |
| **Polling Interval** | Correct interval for each HF range | P0 |
| | Infinity → 15 min | P0 |
| **Alert Engine** | Alert triggered at each threshold (2.0, 1.5, 1.2, 1.0) | P0 |
| | Alert deduplication within cooldown window | P0 |
| | Alert resolved when HF recovers above threshold | P1 |
| | Multiple safes alerting simultaneously | P1 |
| | Severity escalation (WARNING → CRITICAL) | P1 |
| **Polling Scheduler** | Batch multicall correctly groups safes | P1 |
| | RPC failure retries with exponential backoff | P1 |
| **Event Indexer** | Discovers safes from historical events | P0 |
| | Resumes from last indexed block on restart | P1 |
| **API Endpoints** | GET /safes returns paginated results | P0 |
| | GET /safes/:address returns correct safe detail | P0 |
| | Filtering by health factor range works | P1 |
| | WebSocket pushes real-time updates | P2 |
| **Data Transformation** | CashLens response → domain model mapping | P0 |
| | USD value normalization (6 decimals) | P0 |
| | JSONB collateral details serialization | P1 |

### 8.2 Integration Tests (Fastify inject + Test DB)

| Test Case | Description |
|-----------|-------------|
| End-to-end health polling | Mock RPC responses → verify DB snapshot created → verify API returns data |
| Alert lifecycle | Inject declining HF → verify alert created → inject recovery → verify resolved |
| Safe discovery + polling | Simulate factory event → verify safe registered → verify health polled |
| API pagination & filtering | Seed DB with 100 safes → verify pagination, sorting, filtering |
| WebSocket subscription | Connect WS → trigger health update → verify message received |
| Concurrent polling | Multiple safes polled simultaneously → verify no race conditions |

### 8.3 Contract Interaction Tests (Forked Mainnet)

| Test Case | Description |
|-----------|-------------|
| CashLens data accuracy | Call CashLens on real safes via forked mainnet → verify parsed correctly |
| Token symbol resolution | Verify ERC20 symbol() calls return expected symbols |
| Multicall batching | Batch 50 safe reads → verify all return correct data |

### 8.4 Edge Case Tests

| Test Case | Description |
|-----------|-------------|
| Safe with no collateral, no debt | HF should be Infinity, no alerts |
| Safe in Debit mode (no borrowing) | Should still be tracked but HF = Infinity |
| Asset price goes to 0 | HF collapses → LIQUIDATABLE alert immediately |
| Extremely high debt relative to collateral | HF < 0.1 → verify correct display and alert |
| RPC provider goes down | Graceful degradation; serves last known data with staleness warning |

---

## 9. Performance Testing Plan (JMeter)

### 9.1 Test Environment Setup

```
JMeter Machine ──── HTTP/WS ────► Application Server ────► PostgreSQL
                                        │
                                        ├── Mock RPC Server (WireMock)
                                        └── Redis (BullMQ)
```

Use **WireMock** to simulate Ethereum RPC responses so tests are deterministic and don't hit real nodes.

### 9.2 Test Scenarios

#### Scenario 1: API Load Test — Safe List Endpoint
```
Target: GET /api/safes?page=1&limit=50
Goal:   Verify API handles concurrent dashboard users
Setup:  Seed DB with 10,000 safes + 1M snapshot rows

Thread Group:
  - Threads (users):    50 concurrent
  - Ramp-up period:     30 seconds
  - Loop count:         100
  - Duration:           5 minutes

Assertions:
  - p95 response time < 200ms
  - p99 response time < 500ms
  - Error rate < 0.1%
  - Throughput > 500 req/s
```

#### Scenario 2: API Load Test — Safe Detail + History
```
Target: GET /api/safes/:address + GET /api/safes/:address/history
Goal:   Verify detail pages load fast under load
Setup:  Seed DB with 10,000 safes, 500 snapshots each

Thread Group:
  - Threads:    30 concurrent
  - Ramp-up:    20 seconds
  - Loop:       200 (random safe address per request)
  - Duration:   5 minutes

Assertions:
  - p95 response time < 300ms
  - Error rate < 0.1%
```

#### Scenario 3: Polling Throughput Test
```
Target: Internal health polling pipeline
Goal:   Verify system can poll 10,000 safes within acceptable cycle time
Setup:  10,000 safes in DB; WireMock simulating RPC responses (50ms latency)

Measurement:
  - Total cycle time to poll all 10,000 safes
  - Target: < 60 seconds (with multicall batching of 100 safes per call)
  - Memory usage stays < 512MB
  - No dropped/failed polls
```

#### Scenario 4: WebSocket Stress Test
```
Target: WS /ws/health
Goal:   Verify WebSocket handles many concurrent connections
Setup:  JMeter WebSocket Sampler plugin

Thread Group:
  - Connections:   200 concurrent WebSocket clients
  - Duration:      5 minutes
  - Message rate:  1 update/second broadcast

Assertions:
  - All clients receive updates within 100ms of broadcast
  - No dropped connections
  - Memory usage stable (no leak)
```

#### Scenario 5: Alert Storm Test
```
Target: Alert engine under mass liquidation event (market crash scenario)
Goal:   Verify system doesn't collapse when 500+ safes go critical simultaneously
Setup:  Seed 5,000 safes; simulate price drop making 500 safes critical

Measurement:
  - All 500 alerts generated within 30 seconds
  - No duplicate alerts
  - API remains responsive (p95 < 500ms) during alert storm
  - Notification delivery queue doesn't overflow
```

#### Scenario 6: Database Query Performance
```
Target: PostgreSQL under load
Goal:   Verify queries perform well with realistic data volume

Dataset:
  - 10,000 safes
  - 5,000,000 snapshots (500 per safe)
  - 50,000 alerts

Queries to Benchmark:
  - List safes sorted by health_factor ASC (find riskiest)
  - Aggregate overview stats (COUNT, SUM, AVG)
  - Time-series for single safe (last 7 days, 30 days)
  - Alert count by severity in last 24h

Target: All queries < 100ms with proper indexes
```

### 9.3 JMeter Test Plan Structure

```
Test Plan
├── Thread Group 1: API Load (Safe List)
│   ├── HTTP Sampler: GET /api/safes
│   ├── Response Assertion (200 OK)
│   ├── JSON Assertion (array length > 0)
│   └── Duration Assertion (< 500ms)
│
├── Thread Group 2: API Load (Safe Detail)
│   ├── CSV Data Set (safe_addresses.csv)
│   ├── HTTP Sampler: GET /api/safes/${address}
│   └── Duration Assertion (< 300ms)
│
├── Thread Group 3: WebSocket Connections
│   ├── WebSocket Open Connection
│   ├── WebSocket Message Listener (5 min)
│   └── WebSocket Close Connection
│
├── Thread Group 4: Alert Storm Simulation
│   ├── HTTP Sampler: POST /api/test/simulate-price-drop
│   ├── Constant Timer (wait 30s)
│   └── HTTP Sampler: GET /api/alerts/active (verify count)
│
├── Listeners
│   ├── Summary Report
│   ├── Aggregate Report
│   ├── Response Time Graph
│   └── JTL File Writer (for CI analysis)
│
└── Config Elements
    ├── HTTP Request Defaults
    ├── HTTP Header Manager (Content-Type: application/json)
    └── CSV Data Set Config (safe_addresses.csv)
```

### 9.4 Performance Targets Summary

| Metric | Target |
|--------|--------|
| API p95 latency (list) | < 200ms |
| API p95 latency (detail) | < 300ms |
| Polling cycle (10K safes) | < 60 seconds |
| WebSocket broadcast delay | < 100ms |
| Alert generation (500 simultaneous) | < 30 seconds |
| Max concurrent API users | 100+ |
| Max WebSocket connections | 500+ |
| Database query time (indexed) | < 100ms |
| Memory usage (steady state) | < 512MB |

---

## 10. Project Structure

```
cash-safe-monitor/
├── docker-compose.yml          # Postgres + Redis + App
├── Dockerfile
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env.example
├── README.md                   # Quick start guide
│
├── src/
│   ├── index.ts                # App entrypoint
│   ├── config.ts               # Environment config
│   │
│   ├── contracts/              # ABI + typed contract bindings
│   │   ├── abis/
│   │   │   ├── UserSafeLens.ts # CashLens ABI (getSafeCashData)
│   │   │   └── UserSafeFactory.ts
│   │   └── index.ts            # viem contract instances
│   │
│   ├── db/
│   │   ├── schema.ts           # Drizzle schema
│   │   ├── migrations/
│   │   └── index.ts            # DB connection
│   │
│   ├── services/
│   │   ├── safe-discovery.ts   # Event indexer for finding safes
│   │   ├── health-poller.ts    # Periodic health computation
│   │   ├── alert-engine.ts     # Threshold-based alerting
│   │   └── notifier.ts         # Slack/webhook delivery
│   │
│   ├── api/
│   │   ├── server.ts           # Fastify setup
│   │   ├── routes/
│   │   │   ├── safes.ts
│   │   │   ├── alerts.ts
│   │   │   └── overview.ts
│   │   └── ws/
│   │       └── health.ts       # WebSocket handler
│   │
│   ├── workers/
│   │   ├── poll-queue.ts       # BullMQ queue definitions
│   │   └── poll-worker.ts      # BullMQ worker processing
│   │
│   └── utils/
│       ├── health-calc.ts      # Health severity + polling intervals
│       ├── multicall.ts        # Batched RPC helper + token symbol cache
│       └── logger.ts           # Structured logging (pino)
│
├── test/
│   ├── unit/
│   │   ├── health-calc.test.ts
│   │   ├── alert-engine.test.ts
│   │   └── polling-scheduler.test.ts
│   ├── integration/
│   │   ├── api.test.ts
│   │   └── alert-lifecycle.test.ts
│   └── fixtures/
│       └── mock-rpc-responses.ts
│
├── jmeter/
│   ├── api-load-test.jmx
│   ├── websocket-stress.jmx
│   ├── alert-storm.jmx
│   └── data/
│       └── safe_addresses.csv
│
└── dashboard/                  # React SPA
    ├── src/
    │   ├── App.tsx
    │   ├── pages/
    │   │   ├── Overview.tsx
    │   │   ├── SafeList.tsx
    │   │   ├── SafeDetail.tsx
    │   │   └── Alerts.tsx
    │   └── components/
    │       ├── HealthGauge.tsx
    │       ├── HealthChart.tsx
    │       └── SafeTable.tsx
    └── package.json
```

---

## 12. Key Design Decisions & Trade-offs

| Decision | Trade-off | Reasoning |
|----------|-----------|-----------|
| **Single CashLens call per safe** | Depends on one contract | One call returns all needed data (collateral, debt, prices, mode); eliminates need for separate price/debt contract calls |
| **Poll-based vs Event-driven** | Polling uses more RPC calls but is simpler and more reliable | Events alone miss price changes that affect HF; polling guarantees freshness |
| **PostgreSQL vs Time-series DB (InfluxDB)** | Postgres is less optimized for time-series but avoids additional infra | Data volume is manageable (~10K safes); JSONB + indexes are sufficient |
| **Monolith vs Microservices** | Monolith is less scalable but much faster to build in 48h | Single process with BullMQ workers gives enough separation of concerns |
| **Store snapshots vs Compute on-the-fly** | Storage cost vs query speed | Snapshots enable historical charts and trend analysis; storage is cheap |
| **In-memory token symbol cache** | Not persistent across restarts | Symbols don't change; cache rebuilds quickly on startup via ERC20 calls |
| **viem over ethers.js** | Smaller community vs better TypeScript types | viem's multicall support and type-safe contract reads are a clear win for this use case |

---

## 13. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| RPC rate limiting | Polling delays | Use multicall batching; multiple RPC providers; adaptive frequency |
| Chain reorg | Incorrect safe discovery | Re-index last N blocks on each poll cycle; idempotent processing |
| CashLens contract upgrade | Breaking ABI changes | Monitor proxy implementation changes; version ABIs |
| Large number of safes (>50K) | Polling cycle too slow | Horizontal scaling: shard safes across multiple workers |
| Database growth | Slow queries over time | Partition snapshots by month; retention policy (e.g., 90 days detailed, then hourly aggregates) |

---

## 14. Telemetry & Observability

All backend services emit structured JSON logs via Pino. Telemetry log entries include a `telemetry` discriminator field, making them easy to filter from regular application logs (e.g. with `jq`).

### Convention

Every telemetry log entry contains `"telemetry": "<category>"` as a top-level field. This allows filtering all operational metrics from the log stream:

```bash
# Stream all telemetry logs
docker compose logs --tail 50 backend | cut -d'|' -f2- | grep '^\s*{' | jq 'select(.telemetry)'

# Filter to a specific category
docker compose logs --tail 100 backend | cut -d'|' -f2- | grep '^\s*{' | jq 'select(.telemetry == "poll_cycle")'
```

### Categories

| Category | Source | Description |
|----------|--------|-------------|
| `http_request` | `src/api/server.ts` | Emitted on every HTTP response. Includes `reqId`, `method`, `url`, `statusCode`, `durationMs`. |
| `poll_cycle` | `src/services/health-poller.ts` | Emitted after each poll round. Includes `processed`, `errors`, `total`, `cycleDurationMs`, `avgPerSafeMs`, and a `distribution` object with counts by health severity (healthy/info/warning/critical/liquidatable/noDebt). |
| `job_completed` | `src/workers/poll-worker.ts` | Emitted when a BullMQ job finishes successfully. Includes `jobId`, `jobType`, `durationMs`, `attempts`. |
| `job_failed` | `src/workers/poll-worker.ts` | Emitted when a BullMQ job fails. Includes `jobId`, `jobType`, `attempts`, `error`. |
| `ws_connect` / `ws_disconnect` | `src/api/ws/health.ts` | Emitted on WebSocket connect/disconnect. Includes `clientCount`. |
| `ws_broadcast` | `src/api/ws/health.ts` | Debug-level. Emitted on each broadcast. Includes `safeAddress`, `recipientCount`, `delivered`. |
| `system_stats` | `src/utils/system-stats.ts` | Emitted every 60 seconds. Includes `uptimeSeconds`, `memory` (rssMb, heapUsedMb, heapTotalBytes, rssBytes), `pid`. |

### Example Queries

```bash
# Stream all telemetry logs
docker compose logs --tail 50 backend | cut -d'|' -f2- | grep '^\s*{' | jq 'select(.telemetry)'

# Filter to a specific category
docker compose logs --tail 100 backend | cut -d'|' -f2- | grep '^\s*{' | jq 'select(.telemetry == "poll_cycle")'

```

### Prometheus Metrics & Grafana Dashboards

Prometheus metrics are exported at `GET /metrics` via `prom-client`. A pre-provisioned Grafana dashboard is included.

**Exported metrics:**

| Metric | Type | Labels | Source |
|--------|------|--------|--------|
| `http_request_duration_seconds` | Histogram | method, route, status | `src/api/server.ts` |
| `http_requests_total` | Counter | method, route, status | `src/api/server.ts` |
| `poll_cycle_duration_seconds` | Histogram | — | `src/services/health-poller.ts` |
| `poll_cycle_safes_processed` | Counter | — | `src/services/health-poller.ts` |
| `poll_cycle_errors_total` | Counter | — | `src/services/health-poller.ts` |
| `safes_by_health_severity` | Gauge | severity | `src/services/health-poller.ts` |
| `safes_total` | Gauge | — | `src/services/health-poller.ts` |
| `bullmq_job_duration_seconds` | Histogram | job_type | `src/workers/poll-worker.ts` |
| `bullmq_jobs_total` | Counter | job_type, status | `src/workers/poll-worker.ts` |
| `ws_clients_connected` | Gauge | — | `src/api/ws/health.ts` |
| `alerts_fired_total` | Counter | severity | `src/services/alert-engine.ts` |

Default Node.js process metrics (memory, CPU, event-loop lag) are also collected via `collectDefaultMetrics()`.

**Infrastructure:** Prometheus (`localhost:9090`) and Grafana (`localhost:3001`, admin/admin) are included in `docker-compose.yml`. The Grafana dashboard is auto-provisioned from `monitoring/grafana/dashboards/cash-monitor.json`.

---

## 15. Future Improvements

This section documents features that are designed or partially built but not yet fully wired up, as well as new improvements that would strengthen the system for production use.

### 15.1 Adaptive Polling Frequency

**Status:** Utility function exists (`getPollingInterval()` in `src/utils/health-calc.ts`), but is not used for scheduling.

**Current behavior:** All safes are polled together on a fixed 30-second interval (`POLL_INTERVAL_MS`).

**Proposed design:** Schedule each safe (or tier of safes) independently based on health factor urgency:

| Health Factor Range | Poll Interval | Rationale |
|---------------------|---------------|-----------|
| HF > 2.0            | Every 5 min   | Low risk; conserve RPC calls |
| 1.5 < HF ≤ 2.0     | Every 2 min   | Moderate risk |
| 1.2 < HF ≤ 1.5     | Every 30 sec  | High risk; approaching danger |
| HF ≤ 1.2            | Every 10 sec  | Critical; near liquidation |
| No debt (HF = ∞)    | Every 15 min  | No risk; minimal polling |

**Implementation path:** Group safes into urgency tiers after each poll. Maintain per-tier BullMQ repeatable jobs with different intervals, or use a priority queue where critical safes are re-enqueued sooner. This would reduce RPC load for large safe populations while keeping critical safes tightly monitored.

### 15.2 Additional Notification Channels

**Status:** Only Slack incoming webhooks are implemented (`src/services/notifier.ts`).

**Described but not built:**
- **PagerDuty** — For on-call escalation of CRITICAL/LIQUIDATABLE alerts. Would use the PagerDuty Events API v2 to create incidents with severity mapping.
- **Telegram** — Bot-based notifications via the Telegram Bot API. Useful for mobile-first alerting.
- **Generic Webhooks** — Configurable HTTP POST to arbitrary endpoints, enabling integration with OpsGenie, Discord, or custom internal tooling.
- **Email** — SMTP or SendGrid-based email alerts for non-urgent summary digests (e.g., daily health report).

**Implementation path:** The notifier already uses `Promise.allSettled()` to support multiple delivery targets. Adding channels means adding parallel delivery functions gated by environment variables (e.g., `PAGERDUTY_ROUTING_KEY`, `TELEGRAM_BOT_TOKEN`).

### 15.3 Data Retention & Snapshot Partitioning

**Status:** Not implemented. Snapshots accumulate indefinitely.

**Problem:** At 10K safes polled every 30 seconds, the `safe_snapshots` table grows by ~29M rows/day. Without retention, query performance degrades and storage costs escalate.

**Proposed strategy:**
1. **Change Data Capture (CDC) pattern** — Before inserting a new snapshot, compare the incoming values (health factor, collateral, debt, liquidation status) against the safe's current state in `user_safes`. Only create a snapshot row if something has actually changed. This avoids writing identical rows every poll cycle for safes whose on-chain state hasn't moved, dramatically reducing write volume. 

2. **Time-based partitioning** — Partition `safe_snapshots` by month using PostgreSQL native table partitioning (`PARTITION BY RANGE (created_at)`). Drizzle doesn't natively support partitioning, so this would be a raw SQL migration.
3. **Retention policy** — A scheduled cleanup job (daily cron via BullMQ) that:
   - Keeps full-resolution snapshots for the last 7 days
   - Aggregates to hourly averages for 7–90 days
   - Drops data older than 90 days (or archives to cold storage)
4. **Materialized views** — Pre-compute daily/hourly rollups for the history chart endpoint to avoid scanning millions of rows.

### 15.4 Chain Reorg Handling

**Status:** Not implemented. Safe discovery is a one-shot operation with no reorg awareness.

**Risk:** A chain reorganization could cause the event indexer to record a safe that was created in an uncle block (later orphaned). The safe would exist in our DB but not on the canonical chain.

**Proposed strategy:**
- Track the last indexed block number in a persistent `indexer_state` table
- On each poll cycle, re-scan the last N blocks (e.g., 64) to catch reorgs
- Use idempotent upserts (`ON CONFLICT DO NOTHING`) so re-indexing is safe
- For the WebSocket live watcher, viem's `watchEvent` already handles reorgs internally by re-emitting events, but explicit confirmation depth (wait 12 blocks before treating a safe as confirmed) would add safety

### 15.5 WebSocket Subscriptions & Filtering

**Status:** Current WebSocket is a one-way broadcast — all connected clients receive updates for all safes.

**Proposed improvements:**
- **Per-safe subscriptions** — Clients send a `{ "subscribe": ["0xabc...", "0xdef..."] }` message to receive updates only for specific safes
- **Threshold filtering** — Clients can request updates only when HF drops below a threshold (e.g., `{ "threshold": 1.5 }`)
- **Heartbeat/ping-pong** — Add periodic keepalive pings to detect stale connections faster and prevent proxy timeouts

### 15.6 Integration & Contract Interaction Tests

**Status:** Integration tests exist for API endpoints and alert lifecycle. Contract interaction tests (forked mainnet) are not implemented.

**Missing test coverage:**
- **Forked mainnet tests** — Call `CashLens.getSafeCashData()` on real Scroll safes via a local fork to verify ABI parsing and data transformation
- **Multicall edge cases** — Test behavior when a single safe in a batch reverts (should not fail the entire batch)
- **WebSocket integration** — Connect a WS client, trigger a health update, verify the message format
- **End-to-end polling pipeline** — Mock RPC → poll → verify DB snapshot + alert + WS broadcast

### 15.7 RPC Resilience & Multi-Provider Failover

**Status:** Single RPC endpoint configured via `RPC_URL`. No failover.

**Proposed improvements:**
- **Multi-provider fallback** — Configure a list of RPC URLs (e.g., Ankr, Alchemy, public Scroll RPC). On failure, rotate to the next provider with exponential backoff.
- **Request-level retries** — Wrap viem transport with automatic retry (viem supports `retryCount` and `retryDelay` natively)
- **Circuit breaker** — If an RPC provider returns errors for N consecutive requests, temporarily remove it from the rotation and alert operators
- **Rate limit awareness** — Track 429 responses and throttle requests per provider

### 15.8 Dashboard Enhancements

**Status:** Core pages (Overview, Safe List, Safe Detail, Alerts) are implemented.

**Proposed improvements:**
- **Collateral pie chart** — Safe Detail page describes a pie chart for collateral breakdown but only shows a list currently
- **Safe event timeline** — Show recent on-chain events (borrows, repays, deposits, withdrawals) on the Safe Detail page
- **Health factor heatmap** — Overview page showing a grid/heatmap of all safes color-coded by health severity
- **Alert sound/browser notifications** — Browser push notifications or audio alerts when a CRITICAL alert fires
- **Dark/light mode toggle** — Currently dark-only
- **Mobile responsiveness** — Improve layout for small screens; the data-dense tables need horizontal scroll or card layouts on mobile

### 15.9 Historical Health Factor Simulation

**Proposed feature:** A "what-if" simulator that lets operators adjust collateral prices or debt amounts and see how health factors would change across all safes. This would help assess protocol-wide risk in market crash scenarios (e.g., "what happens if ETH drops 30%?").

**Implementation path:**
- Add a `/api/simulate` endpoint that accepts price overrides and returns recalculated HFs for all safes
- Dashboard UI with sliders for each collateral token price
- Compute adjusted HF as `(adjustedCollateralUsd * maxBorrowRatio) / totalDebtUsd`
