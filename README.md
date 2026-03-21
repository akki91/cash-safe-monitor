# Cash Safe LTV Health Monitor

Monitoring system for ether.fi Cash Safe LTV Health. Tracks the health factor of every user safe where users borrow USDC against crypto collateral, and alerts when positions approach liquidation.

For architecture, design decisions, test plan, and performance testing details, see the **[Design Document](./DESIGN_DOC.md)**.

## Prerequisites

- **Docker** and **Docker Compose** (v2.20+)
- **Node.js 20+** (for non container development environment only)
- A **Scroll chain RPC endpoint** — the project monitors ether.fi Cash safes on [Scroll](https://scroll.io). Use a provider like Ankr, Alchemy, or the public `https://rpc.scroll.io`

> **Note:** Safe addresses are loaded from a CSV file at startup. The initial CSV was generated from [Dune Analytics](https://dune.com/queries/4532934/7566624) using `scroll.logs` to find borrow events from the ether.fi Cash protocol — giving us safes that have actively borrowed and have meaningful health factors to monitor.

## Run with Docker

```bash
git clone <repo-url>
cd cash-safe-monitor

cp .env.example .env
# Edit .env — set RPC_URL to a Scroll chain RPC endpoint (e.g. Ankr, Alchemy, or https://rpc.scroll.io)

docker compose up --build

# Backend API:  http://localhost:3000
# Dashboard:    http://localhost:5173
# Prometheus:   http://localhost:9090
# Grafana:      http://localhost:3001  (admin / admin)
```

## Re-seed Database (without restarting)

To clear all data and re-import addresses from CSV without restarting containers:

```bash
# Docker
docker compose exec backend node dist/scripts/reseed.js

# Local development
npm run db:reseed
```

## Run Locally (Development)

```bash
# Install dependencies
npm install
cd dashboard && npm install && cd ..

# Start Postgres and Redis
docker compose up postgres redis -d

# Configure environment
cp .env.example .env
# Edit .env — set RPC_URL to a Scroll chain RPC endpoint

# Push database schema
npm run db:push

# Start backend (watches for changes)
npm run dev

# Start dashboard (in a new terminal)
cd dashboard && npm run dev
```

## Run Tests

```bash
npm test          # Unit tests (39 tests)
npm run test:integration # Integration tests
npm run test:watch # Watch mode
```

## Performance Tests (JMeter)

```bash
jmeter -n -t jmeter/api-load-test.jmx -l results.jtl
jmeter -n -t jmeter/websocket-stress.jmx -l ws-results.jtl
```
