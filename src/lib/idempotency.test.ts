import { describe, it, expect } from "vitest";
import { canonicalize, computeHashes } from "./idempotency";

describe("canonicalize", () => {
  it("sorts object keys", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("handles nested objects", () => {
    expect(canonicalize({ a: { z: 1, y: 2 }, b: [3, 2, 1] })).toBe('{"a":{"y":2,"z":1},"b":[3,2,1]}');
  });
  it("same logical body produces same hash", () => {
    const a = canonicalize({ amount: "1.00", token: "USDC" });
    const b = canonicalize({ token: "USDC", amount: "1.00" });
    expect(a).toBe(b);
  });
});

describe("computeHashes", () => {
  it("includes principal in key hash", () => {
    const h1 = computeHashes({
      principal: "user_A",
      rawKey: "idem_123",
      method: "POST",
      path: "/v1/pay",
      body: '{"a":1}',
    });
    const h2 = computeHashes({
      principal: "user_B",
      rawKey: "idem_123",
      method: "POST",
      path: "/v1/pay",
      body: '{"a":1}',
    });
    expect(h1.keyHash).not.toBe(h2.keyHash);
  });
  it("different body produces different request hash", () => {
    const h1 = computeHashes({
      principal: "u",
      rawKey: "k",
      method: "POST",
      path: "/v1/pay",
      body: '{"a":1}',
    });
    const h2 = computeHashes({
      principal: "u",
      rawKey: "k",
      method: "POST",
      path: "/v1/pay",
      body: '{"a":2}',
    });
    expect(h1.keyHash).toBe(h2.keyHash);
    expect(h1.requestHash).not.toBe(h2.requestHash);
  });
});
