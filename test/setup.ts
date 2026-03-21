import "dotenv/config";

// Set test environment defaults
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/cash_monitor_test";
process.env.REDIS_URL = process.env.TEST_REDIS_URL || "redis://localhost:6379";
process.env.RPC_URL = "http://localhost:8545";
process.env.ALERT_COOLDOWN_MINUTES = "15";
process.env.API_PORT = "0"; // random port for tests
