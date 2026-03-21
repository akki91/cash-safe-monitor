// ---------------------------------------------------------------------------
// Mock Ethereum RPC response data for tests
// ---------------------------------------------------------------------------

/**
 * Simulates the response from CashLens.getSafeCashData().
 * Values use 6-decimal USD representation (matching on-chain conventions).
 */
export const mockSafeData = {
  mode: 0, // Credit
  totalCollateralInUsd: 25861340000n, // $25,861.34
  totalBorrowInUsd: 9768920000n, // $9,768.92
  maxBorrowInUsd: 20752370000n, // $20,752.37
  collateralTokens: [
    {
      token: "0x1111000000000000000000000000000000000001",
      balance: 18717340000000000000000n, // 18,717.34 (18 decimals)
      valueInUsd: 16952980000n, // $16,952.98
    },
    {
      token: "0x2222000000000000000000000000000000000002",
      balance: 7321690000n, // 7,321.69 (6 decimals, USDC)
      valueInUsd: 6589520000n, // $6,589.52
    },
    {
      token: "0x3333000000000000000000000000000000000003",
      balance: 1340000000000000000n, // 1.34 ETH (18 decimals)
      valueInUsd: 2318840000n, // $2,318.84
    },
  ],
  borrowTokens: [
    {
      token: "0x2222000000000000000000000000000000000002",
      amount: 9768920000n, // 9,768.92 USDC
      valueInUsd: 9768920000n, // $9,768.92
    },
  ],
};

/**
 * 20 mock safe addresses for test parameterization.
 */
export const mockSafeAddresses: string[] = [
  "0xaaa1000000000000000000000000000000000001",
  "0xaaa2000000000000000000000000000000000002",
  "0xaaa3000000000000000000000000000000000003",
  "0xaaa4000000000000000000000000000000000004",
  "0xaaa5000000000000000000000000000000000005",
  "0xaaa6000000000000000000000000000000000006",
  "0xaaa7000000000000000000000000000000000007",
  "0xaaa8000000000000000000000000000000000008",
  "0xaaa9000000000000000000000000000000000009",
  "0xaaa0000000000000000000000000000000000010",
  "0xbbb1000000000000000000000000000000000011",
  "0xbbb2000000000000000000000000000000000012",
  "0xbbb3000000000000000000000000000000000013",
  "0xbbb4000000000000000000000000000000000014",
  "0xbbb5000000000000000000000000000000000015",
  "0xbbb6000000000000000000000000000000000016",
  "0xbbb7000000000000000000000000000000000017",
  "0xbbb8000000000000000000000000000000000018",
  "0xbbb9000000000000000000000000000000000019",
  "0xbbb0000000000000000000000000000000000020",
];

/**
 * Token prices in 6-decimal USD representation.
 */
export const mockPrices: Record<string, bigint> = {
  "0x1111000000000000000000000000000000000001": 1000000n, // $1.00 (stablecoin)
  "0x2222000000000000000000000000000000000002": 1000000n, // $1.00 (USDC)
  "0x3333000000000000000000000000000000000003": 1730000000n, // $1,730.00 (ETH)
};

/**
 * Mock health metrics for a healthy safe (HF ~2.12).
 */
export const mockHealthyMetrics = {
  totalCollateralUsd: 25861.34,
  totalDebtUsd: 9768.92,
  maxBorrowUsd: 20752.37,
  healthFactor: 2.1243,
  isLiquidatable: false,
};

/**
 * Mock health metrics for a safe near liquidation (HF = 1.1).
 */
export const mockCriticalMetrics = {
  totalCollateralUsd: 12000.0,
  totalDebtUsd: 10000.0,
  maxBorrowUsd: 11000.0,
  healthFactor: 1.1,
  isLiquidatable: false,
};

/**
 * Mock health metrics for a liquidatable safe (HF = 0.9).
 */
export const mockLiquidatableMetrics = {
  totalCollateralUsd: 10000.0,
  totalDebtUsd: 12000.0,
  maxBorrowUsd: 10800.0,
  healthFactor: 0.9,
  isLiquidatable: true,
};
