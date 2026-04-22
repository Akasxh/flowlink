import { describe, it, expect } from "vitest";
import { isTokenSupported, getToken, isValidAddress, HASHKEY_TESTNET } from "./chain";

describe("chain config", () => {
  it("validates supported tokens", () => {
    expect(isTokenSupported("USDC")).toBe(true);
    expect(isTokenSupported("USDT")).toBe(true);
    expect(isTokenSupported("HSK")).toBe(true);
    expect(isTokenSupported("ETH")).toBe(false);
    expect(isTokenSupported("")).toBe(false);
  });
  it("returns null for unsupported tokens", () => {
    expect(getToken("ETH")).toBe(null);
  });
  it("returns config for supported tokens", () => {
    expect(getToken("USDC")?.decimals).toBe(6);
    expect(getToken("HSK")?.decimals).toBe(18);
  });
  it("validates EIP-55 address format", () => {
    expect(isValidAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f8beA0")).toBe(true);
    expect(isValidAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f8beA")).toBe(false); // 39 chars
    expect(isValidAddress("not-an-address")).toBe(false);
    expect(isValidAddress("")).toBe(false);
  });
  it("has the expected chain id", () => {
    expect(HASHKEY_TESTNET.chainId).toBe(133);
  });
});
