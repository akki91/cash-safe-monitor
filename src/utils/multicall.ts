/**
 * Batched RPC helper.
 *
 * Uses viem's built-in multicall to read CashLens data for many safes in a
 * single RPC round-trip, split into configurable batch sizes.
 *
 * Includes retry logic with exponential backoff and configurable inter-batch
 * delays to handle RPC rate limits gracefully.
 */

import { type Address, erc20Abi } from "viem";
import { publicClient, UserSafeLensAbi } from "../contracts/index.js";
import { config } from "../config.js";
import { logger } from "./logger.js";

/** On-chain USD values have 6 decimals. */
const USD_DECIMALS = 1e6;

/** Cache of token address → symbol (populated lazily). */
const symbolCache = new Map<string, string>();

/** Cache of token address → decimals (populated lazily). */
const decimalsCache = new Map<string, number>();

/** Raw data returned for a single safe from the multicall. */
export interface SafeRpcData {
  address: string;
  lensData: {
    mode: number;
    totalCollateralInUsd: bigint;
    totalBorrowInUsd: bigint;
    maxBorrowInUsd: bigint;
    collateralTokens: {
      token: Address;
      balance: bigint;
      valueInUsd: bigint;
    }[];
    borrowTokens: {
      token: Address;
      amount: bigint;
      valueInUsd: bigint;
    }[];
    tokenPrices: {
      token: Address;
      priceUsd: number;
    }[];
    spendingLimitAllowance: bigint;
    creditMaxSpend: bigint;
    totalCashbackEarnedInUsd: bigint;
    withdrawalRequest: {
      tokens: Address[];
      amounts: bigint[];
      withdrawalRequestTimestamp: bigint;
      finalizeTimestamp: bigint;
    };
    debitMaxSpend: {
      spendableTokens: Address[];
      spendableAmounts: bigint[];
      amountsInUsd: bigint[];
      totalSpendableInUsd: bigint;
    };
  } | null;
  isLiquidatable: boolean;
  maxBorrowAmount: bigint | null;
  maxBorrowAmountLiq: bigint | null;
}

/**
 * Retry a function with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; baseDelayMs: number; label?: string },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < opts.retries) {
        const delay = opts.baseDelayMs * Math.pow(2, attempt);
        logger.warn(
          {
            attempt: attempt + 1,
            maxRetries: opts.retries,
            delayMs: delay,
            label: opts.label,
            error: error instanceof Error ? error.message : String(error),
          },
          "RPC call failed, retrying",
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Resolve ERC-20 symbols and decimals for a list of token addresses.
 * Results are cached so each token is only queried once.
 */
export async function resolveTokenMetadata(
  tokens: Address[],
): Promise<{ symbols: Map<string, string>; decimals: Map<string, number> }> {
  const unknown = tokens.filter((t) => !symbolCache.has(t.toLowerCase()));

  if (unknown.length > 0) {
    // Batch symbol + decimals calls together
    const contracts = unknown.flatMap((token) => [
      { address: token, abi: erc20Abi, functionName: "symbol" as const },
      { address: token, abi: erc20Abi, functionName: "decimals" as const },
    ]);

    const results = await withRetry(
      () => publicClient.multicall({ contracts, allowFailure: true }),
      {
        retries: config.polling.rpcRetries,
        baseDelayMs: config.polling.rpcRetryDelayMs,
        label: "resolveTokenMetadata",
      },
    );

    for (let i = 0; i < unknown.length; i++) {
      const addr = unknown[i].toLowerCase();
      const symbolResult = results[i * 2];
      const decimalsResult = results[i * 2 + 1];

      if (symbolResult.status === "success") {
        symbolCache.set(addr, symbolResult.result as string);
      } else {
        symbolCache.set(addr, addr.slice(0, 6) + "…" + addr.slice(-4));
      }

      if (decimalsResult.status === "success") {
        decimalsCache.set(addr, Number(decimalsResult.result));
      } else {
        decimalsCache.set(addr, 18); // default to 18
      }
    }
  }

  const symbols = new Map<string, string>();
  const decimals = new Map<string, number>();
  for (const t of tokens) {
    const key = t.toLowerCase();
    symbols.set(key, symbolCache.get(key) ?? t.slice(0, 10));
    decimals.set(key, decimalsCache.get(key) ?? 18);
  }
  return { symbols, decimals };
}

/**
 * Map raw CashLens getSafeCashData result into the SafeRpcData shape.
 *
 * The CashLens returns collateral as {token, amount} pairs + a separate
 * tokenPrices array. We join them to compute per-token USD values.
 */
function mapLensResult(raw: any): SafeRpcData["lensData"] {
  // Build price lookup: token address (lower) → price in USD (float)
  const priceMap = new Map<string, number>();
  const tokenPrices: SafeRpcData["lensData"] extends null
    ? never
    : NonNullable<SafeRpcData["lensData"]>["tokenPrices"] = [];

  for (const p of raw.tokenPrices) {
    const priceUsd = Number(p.amount) / USD_DECIMALS;
    priceMap.set((p.token as string).toLowerCase(), priceUsd);
    tokenPrices.push({ token: p.token as Address, priceUsd });
  }

  // Map collateral balances and compute per-token USD value
  // Note: balance is in raw token units (variable decimals).
  // We estimate USD using totalCollateral proportional to balance * price.
  const totalCollateralRaw = Number(raw.totalCollateral);
  const collateralTokens = raw.collateralBalances.map((c: any) => ({
    token: c.token as Address,
    balance: c.amount as bigint,
    valueInUsd: 0n, // individual USD not reliably computable without decimals
  }));

  // Map borrows
  const borrowTokens = raw.borrows.map((b: any) => ({
    token: b.token as Address,
    amount: b.amount as bigint,
    valueInUsd: 0n,
  }));

  return {
    mode: raw.mode,
    totalCollateralInUsd: raw.totalCollateral,
    totalBorrowInUsd: raw.totalBorrow,
    maxBorrowInUsd: raw.maxBorrow,
    collateralTokens,
    borrowTokens,
    tokenPrices,
    spendingLimitAllowance: raw.spendingLimitAllowance,
    creditMaxSpend: raw.creditMaxSpend,
    totalCashbackEarnedInUsd: raw.totalCashbackEarnedInUsd,
    withdrawalRequest: {
      tokens: raw.withdrawalRequest.tokens as Address[],
      amounts: raw.withdrawalRequest.amounts as bigint[],
      withdrawalRequestTimestamp: raw.withdrawalRequest.withdrawalRequestTimestamp as bigint,
      finalizeTimestamp: raw.withdrawalRequest.finalizeTimestamp as bigint,
    },
    debitMaxSpend: {
      spendableTokens: raw.debitMaxSpend.spendableTokens as Address[],
      spendableAmounts: raw.debitMaxSpend.spendableAmounts as bigint[],
      amountsInUsd: raw.debitMaxSpend.amountsInUsd as bigint[],
      totalSpendableInUsd: raw.debitMaxSpend.totalSpendableInUsd as bigint,
    },
  };
}

/**
 * Fetch on-chain data for a batch of safe addresses.
 *
 * Each safe requires only 1 call: CashLens.getSafeCashData(safe, []).
 * The CashLens already returns totalCollateral, totalBorrow, maxBorrow,
 * token prices, etc. — a single call provides all needed data.
 *
 * Includes inter-batch delays and retry logic for RPC resilience.
 */
export async function batchGetSafeData(
  addresses: string[],
  batchSize: number = config.polling.multicallBatchSize,
): Promise<SafeRpcData[]> {
  const results: SafeRpcData[] = [];

  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    const batchResults = await fetchBatch(batch);
    results.push(...batchResults);

    logger.debug(
      { processed: results.length, total: addresses.length },
      "Multicall batch progress",
    );

    // Inter-batch delay to avoid RPC rate limits
    if (i + batchSize < addresses.length && config.polling.batchDelayMs > 0) {
      await new Promise((r) => setTimeout(r, config.polling.batchDelayMs));
    }
  }

  return results;
}

async function fetchBatch(addresses: string[]): Promise<SafeRpcData[]> {
  // Build the multicall — 1 call per safe
  const contracts = addresses.map((addr) => ({
    address: config.contracts.userSafeLens,
    abi: UserSafeLensAbi,
    functionName: "getSafeCashData" as const,
    args: [addr as Address, []] as const,
  }));

  const rawResults = await withRetry(
    () => publicClient.multicall({ contracts, allowFailure: true }),
    {
      retries: config.polling.rpcRetries,
      baseDelayMs: config.polling.rpcRetryDelayMs,
      label: `fetchBatch(${addresses.length} safes)`,
    },
  );

  const parsed: SafeRpcData[] = [];

  for (let i = 0; i < addresses.length; i++) {
    const lensResult = rawResults[i];

    const safeData: SafeRpcData = {
      address: addresses[i],
      lensData: null,
      isLiquidatable: false,
      maxBorrowAmount: null,
      maxBorrowAmountLiq: null,
    };

    if (lensResult.status === "success") {
      try {
        const mapped = mapLensResult(lensResult.result)!;
        safeData.lensData = mapped;
        // Derive maxBorrow from lens data
        safeData.maxBorrowAmount = mapped.maxBorrowInUsd;
        // Derive liquidatable: totalBorrow > 0 and maxBorrow <= totalBorrow
        const totalBorrow = Number(mapped.totalBorrowInUsd);
        const maxBorrow = Number(mapped.maxBorrowInUsd);
        safeData.isLiquidatable = totalBorrow > 0 && maxBorrow <= totalBorrow;
      } catch (err) {
        logger.warn(
          {
            safe: addresses[i],
            error: err instanceof Error ? err.message : String(err),
          },
          "Failed to map lens data",
        );
      }
    } else {
      logger.warn(
        { safe: addresses[i], error: lensResult.error?.message },
        "Failed to read lens data",
      );
    }

    parsed.push(safeData);
  }

  return parsed;
}
