// HashKey Chain configuration. Pure constants, no runtime dependencies.
// Imported by any module that needs to reference chain id / RPC / token addresses.

export const HASHKEY_TESTNET = {
  chainId: 133,
  name: "HashKey Chain Testnet",
  rpc: "https://hashkeychain-testnet.alt.technology",
  explorer: "https://hashkeychain-testnet-explorer.alt.technology",
  nativeToken: "HSK",
} as const;

export const SUPPORTED_TOKENS = {
  USDC: {
    symbol: "USDC",
    decimals: 6,
    address: "0x47725537961326e4b906558BD208012c6C11aCa2",
  },
  USDT: {
    symbol: "USDT",
    decimals: 6,
    address: "0x60EFCa24B785391C6063ba37fF917Ff0edEb9f4a",
  },
  HSK: {
    symbol: "HSK",
    decimals: 18,
    address: null, // native
  },
} as const;

export type TokenSymbol = keyof typeof SUPPORTED_TOKENS;

export function isTokenSupported(token: string): token is TokenSymbol {
  return token in SUPPORTED_TOKENS;
}

export function getToken(symbol: string) {
  if (!isTokenSupported(symbol)) return null;
  return SUPPORTED_TOKENS[symbol];
}

// EIP-55 checksum address regex (case-sensitive validation done separately via viem).
export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function isValidAddress(addr: string): boolean {
  return ADDRESS_REGEX.test(addr);
}
