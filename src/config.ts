import "dotenv/config";

export const config = {
  rpc: {
    url: process.env.RPC_URL || "https://rpc.scroll.io",
  },
  db: {
    url:
      process.env.DATABASE_URL ||
      "postgres://postgres:postgres@localhost:5432/cash_monitor",
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },
  contracts: {
    userSafeLens:
      (process.env.USER_SAFE_LENS_ADDRESS as `0x${string}`) ||
      ("0x0000000000000000000000000000000000000000" as `0x${string}`),
  },
  safes: {
    csvPath: process.env.SAFE_ADDRESSES_CSV || "./data/safe_addresses.csv",
  },
  polling: {
    intervalMs: parseInt(process.env.POLL_INTERVAL_MS || "30000"),
    multicallBatchSize: parseInt(process.env.MULTICALL_BATCH_SIZE || "100"),
    rpcRetries: parseInt(process.env.RPC_RETRIES || "3"),
    rpcRetryDelayMs: parseInt(process.env.RPC_RETRY_DELAY_MS || "1000"),
    batchDelayMs: parseInt(process.env.BATCH_DELAY_MS || "100"),
  },
  alerts: {
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || "",
    cooldownMinutes: parseInt(process.env.ALERT_COOLDOWN_MINUTES || "15"),
  },
  api: {
    port: parseInt(process.env.API_PORT || "3000"),
    host: process.env.API_HOST || "0.0.0.0",
  },
};
