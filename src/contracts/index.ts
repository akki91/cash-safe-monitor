import {
  createPublicClient,
  http,
  type PublicClient,
  type Transport,
  type Chain,
} from "viem";
import { scroll } from "viem/chains";
import { config } from "../config.js";
import { UserSafeLensAbi } from "./abis/UserSafeLens.js";

// Re-export ABI for convenience
export { UserSafeLensAbi };

/**
 * HTTP-based public client for standard read operations and multicall.
 */
export const publicClient: PublicClient<Transport, Chain> = createPublicClient({
  chain: scroll,
  transport: http(config.rpc.url),
  batch: {
    multicall: true,
  },
});
