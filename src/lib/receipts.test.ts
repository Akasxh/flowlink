import { describe, it, expect, beforeAll } from "vitest";
import { signReceipt, verifyReceipt, publicKeyPem } from "./receipts";

beforeAll(() => {
  process.env.RECEIPT_SIGNING_KEY_HEX =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
});

describe("receipts", () => {
  it("signs and round-trip verifies", async () => {
    const signed = await signReceipt({
      receipt_id: "rcp_1",
      transaction_id: "txn_1",
      payer_address: "0xaaa",
      receiver_address: "0xbbb",
      amount: "1.00",
      token: "USDC",
      chain_id: 133,
      tx_hash: "0x01",
      block: 1,
      settled_at: "2026-04-22T00:00:00.000Z",
      compliance: { ofac: "clear", velocity: "within_limits", score: 100 },
    });
    expect(signed.signature.algo).toBe("ed25519");
    expect(signed.signature.signed_payload_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const ok = await verifyReceipt(signed);
    expect(ok).toBe(true);
  });

  it("rejects a tampered receipt", async () => {
    const signed = await signReceipt({
      receipt_id: "rcp_2",
      transaction_id: "txn_2",
      payer_address: "0xaaa",
      receiver_address: "0xbbb",
      amount: "1.00",
      token: "USDC",
      chain_id: 133,
      tx_hash: "0x01",
      block: 1,
      settled_at: "2026-04-22T00:00:00.000Z",
      compliance: { ofac: "clear", velocity: "within_limits", score: 100 },
    });
    const tampered = { ...signed, amount: "999999.00" };
    const ok = await verifyReceipt(tampered);
    expect(ok).toBe(false);
  });

  it("publicKeyPem returns a valid PEM envelope", async () => {
    const pem = await publicKeyPem();
    expect(pem).toMatch(/^-----BEGIN PUBLIC KEY-----\n/);
    expect(pem).toMatch(/\n-----END PUBLIC KEY-----\n$/);
  });
});
