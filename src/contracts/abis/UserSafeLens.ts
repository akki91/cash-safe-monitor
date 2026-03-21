export const UserSafeLensAbi = [
  {
    type: "function",
    name: "getSafeCashData",
    inputs: [
      { name: "safe", type: "address" },
      { name: "debtServiceTokenPreference", type: "address[]" },
    ],
    outputs: [
      {
        name: "safeCashData",
        type: "tuple",
        components: [
          { name: "mode", type: "uint8" },
          {
            name: "collateralBalances",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          {
            name: "borrows",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          {
            name: "tokenPrices",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          {
            name: "withdrawalRequest",
            type: "tuple",
            components: [
              { name: "tokens", type: "address[]" },
              { name: "amounts", type: "uint256[]" },
              { name: "withdrawalRequestTimestamp", type: "uint256" },
              { name: "finalizeTimestamp", type: "uint256" },
            ],
          },
          { name: "totalCollateral", type: "uint256" },
          { name: "totalBorrow", type: "uint256" },
          { name: "maxBorrow", type: "uint256" },
          { name: "creditMaxSpend", type: "uint256" },
          { name: "spendingLimitAllowance", type: "uint256" },
          { name: "totalCashbackEarnedInUsd", type: "uint256" },
          { name: "incomingModeStartTime", type: "uint256" },
          {
            name: "debitMaxSpend",
            type: "tuple",
            components: [
              { name: "spendableTokens", type: "address[]" },
              { name: "spendableAmounts", type: "uint256[]" },
              { name: "amountsInUsd", type: "uint256[]" },
              { name: "totalSpendableInUsd", type: "uint256" },
            ],
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getUserTotalCollateral",
    inputs: [{ name: "safe", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;
