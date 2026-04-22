// Receipt module — ed25519-signed settlement proofs.
//
// Receipts are canonical-JSON-serialized then hashed (sha256), and the hash is signed.
// Public key is published at /.well-known/flowlink-receipt-pubkey.pem so any third party
// can verify without any FlowLink dependency.

import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { sha512 } from "@noble/hashes/sha512";
import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { canonicalize } from "./idempotency";

// @noble/ed25519 sync API needs sha512 injected.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export type ReceiptPayload = {
  receipt_id: string;
  transaction_id: string;
  invoice_id?: string;
  payer_address: string;
  receiver_address: string;
  amount: string;
  token: string;
  chain_id: number;
  tx_hash: string;
  block: number;
  settled_at: string;
  compliance: {
    ofac: "clear" | "blocked";
    velocity: "within_limits" | "exceeded";
    score: number;
  };
};

export type SignedReceipt = ReceiptPayload & {
  signature: {
    algo: "ed25519";
    signer: "flowlink.ink";
    key_id: string;
    signed_payload_hash: string; // "sha256:<hex>"
    signature: string; // base64
    public_key_url: string;
  };
};

function getReceiptKey(): Uint8Array {
  const hex = process.env.RECEIPT_SIGNING_KEY_HEX;
  if (!hex || hex.length !== 64) {
    throw new Error("RECEIPT_SIGNING_KEY_HEX missing or wrong length (expect 64 hex = 32 bytes)");
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function currentReceiptKeyId(): string {
  const now = new Date();
  return `flk-receipt-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function signReceipt(payload: ReceiptPayload): Promise<SignedReceipt> {
  const canonical = canonicalize(payload);
  const digest = sha256(new TextEncoder().encode(canonical));
  const digestHex = Buffer.from(digest).toString("hex");
  const key = getReceiptKey();
  const sig = await ed.signAsync(digest, key);

  return {
    ...payload,
    signature: {
      algo: "ed25519",
      signer: "flowlink.ink",
      key_id: currentReceiptKeyId(),
      signed_payload_hash: `sha256:${digestHex}`,
      signature: Buffer.from(sig).toString("base64"),
      public_key_url: "https://flowlink.ink/.well-known/flowlink-receipt-pubkey.pem",
    },
  };
}

export async function verifyReceipt(receipt: SignedReceipt): Promise<boolean> {
  const { signature, ...payload } = receipt;
  const canonical = canonicalize(payload);
  const digest = sha256(new TextEncoder().encode(canonical));
  const expected = `sha256:${Buffer.from(digest).toString("hex")}`;
  if (expected !== signature.signed_payload_hash) return false;
  const sig = Buffer.from(signature.signature, "base64");
  const priv = getReceiptKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return ed.verifyAsync(new Uint8Array(sig), digest, pub);
}

export async function publicKeyHex(): Promise<string> {
  const priv = getReceiptKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return Buffer.from(pub).toString("hex");
}

// PEM export for /.well-known/flowlink-receipt-pubkey.pem
export async function publicKeyPem(): Promise<string> {
  const priv = getReceiptKey();
  const pub = await ed.getPublicKeyAsync(priv);
  // Ed25519 SPKI DER prefix (RFC 8410) + raw 32-byte key
  const spkiHeader = Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
  const spki = Buffer.concat([spkiHeader, Buffer.from(pub)]);
  const b64 = spki.toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

// Persistence — one receipt per transaction.
export async function storeReceipt(receipt: SignedReceipt): Promise<void> {
  const { signature, ...payload } = receipt;
  await prisma.receipt.create({
    data: {
      id: receipt.receipt_id,
      flowlinkId: `flowlink:rcp/${receipt.receipt_id}`,
      transactionId: receipt.transaction_id,
      payloadJson: JSON.stringify(payload),
      signature: signature.signature,
      keyId: signature.key_id,
      algo: signature.algo,
    },
  });
}

// Canonical JSON hash — exported for use by test harnesses.
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
