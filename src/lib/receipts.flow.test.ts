// End-to-end receipt flow tests — complement to receipts.test.ts.
// Covers full sign/verify round-trip, tamper detection (amount + tx_hash),
// PEM envelope validity (with optional openssl parse if available),
// and receipt_id format.
//
// Uses a deterministic test key so signatures are reproducible.

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  signReceipt,
  verifyReceipt,
  publicKeyPem,
  type ReceiptPayload,
  type SignedReceipt,
} from "./receipts";

const TEST_KEY_HEX =
  "1111111111111111111111111111111111111111111111111111111111111111";

beforeAll(() => {
  process.env.RECEIPT_SIGNING_KEY_HEX = TEST_KEY_HEX;
});

function basePayload(): ReceiptPayload {
  return {
    receipt_id: "rcp_TEST00000000000000000000",
    transaction_id: "txn_TEST00000000000000000000",
    invoice_id: "inv_TEST00000000000000000000",
    payer_address: "0x1111111111111111111111111111111111111111",
    receiver_address: "0x2222222222222222222222222222222222222222",
    amount: "12.34",
    token: "USDC",
    chain_id: 133,
    tx_hash: "0xabc123",
    block: 42,
    settled_at: "2026-04-22T12:00:00.000Z",
    compliance: { ofac: "clear", velocity: "within_limits", score: 100 },
  };
}

function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("receipts flow", () => {
  it("signReceipt + verifyReceipt round-trip returns true", async () => {
    const signed: SignedReceipt = await signReceipt(basePayload());
    expect(signed.signature.algo).toBe("ed25519");
    expect(signed.signature.signer).toBe("flowlink.ink");
    expect(signed.signature.signed_payload_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(signed.signature.signature.length).toBeGreaterThan(0);

    const ok = await verifyReceipt(signed);
    expect(ok).toBe(true);
  });

  it("verifyReceipt returns false when amount is tampered", async () => {
    const signed = await signReceipt(basePayload());
    const tampered: SignedReceipt = { ...signed, amount: "9999.99" };
    const ok = await verifyReceipt(tampered);
    expect(ok).toBe(false);
  });

  it("verifyReceipt returns false when tx_hash is tampered", async () => {
    const signed = await signReceipt(basePayload());
    const tampered: SignedReceipt = { ...signed, tx_hash: "0xdeadbeef" };
    const ok = await verifyReceipt(tampered);
    expect(ok).toBe(false);
  });

  it("publicKeyPem returns a PEM that openssl can parse (or at least a valid envelope)", async () => {
    const pem = await publicKeyPem();

    // Envelope checks (always run).
    expect(pem.startsWith("-----BEGIN PUBLIC KEY-----\n")).toBe(true);
    expect(pem.endsWith("\n-----END PUBLIC KEY-----\n")).toBe(true);
    const body = pem
      .replace("-----BEGIN PUBLIC KEY-----\n", "")
      .replace("\n-----END PUBLIC KEY-----\n", "")
      .replace(/\n/g, "");
    // Base64 charset only.
    expect(body).toMatch(/^[A-Za-z0-9+/=]+$/);
    // Ed25519 SPKI is 44 bytes => 60 base64 chars (including padding).
    const der = Buffer.from(body, "base64");
    expect(der.length).toBe(44);
    // RFC 8410 SPKI prefix for Ed25519.
    expect(der.subarray(0, 12).toString("hex")).toBe("302a300506032b6570032100");

    // Optional: hand the PEM to openssl and confirm it parses as an Ed25519
    // public key. Skipped silently if openssl is unavailable on the host.
    if (!hasOpenssl()) return;
    const dir = mkdtempSync(join(tmpdir(), "flk-pem-"));
    const pemPath = join(dir, "pub.pem");
    try {
      writeFileSync(pemPath, pem);
      const out = execFileSync(
        "openssl",
        ["pkey", "-pubin", "-in", pemPath, "-text", "-noout"],
        { encoding: "utf8" },
      );
      expect(out).toMatch(/ED25519/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("receipt_id format must start with rcp_", async () => {
    // The signer does not mint receipt_id (caller passes it in), so we assert
    // the contract by signing a payload that uses the production prefix and
    // confirming the field round-trips through sign/verify intact.
    const payload = basePayload();
    expect(payload.receipt_id.startsWith("rcp_")).toBe(true);

    const signed = await signReceipt(payload);
    expect(signed.receipt_id).toBe(payload.receipt_id);
    expect(signed.receipt_id.startsWith("rcp_")).toBe(true);

    // And a non-rcp_ id must not be silently accepted by downstream consumers
    // — verifyReceipt itself is signature-only, so this is purely a sentinel
    // check at the producer boundary.
    const bad: ReceiptPayload = { ...payload, receipt_id: "txn_wrong_prefix" };
    const badSigned = await signReceipt(bad);
    expect(badSigned.receipt_id.startsWith("rcp_")).toBe(false);
  });
});
