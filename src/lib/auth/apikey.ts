// Scoped API keys.
//
// Format: flk_live_<32-byte-base58> or flk_test_<32-byte-base58>
// Stored as sha256 hash; the raw key is shown once at generation time.
// Scopes are stored as a comma-separated string on the ApiKey row.

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../prisma";

const PREFIX_LIVE = "flk_live_";
const PREFIX_TEST = "flk_test_";

export type ApiKeyScope =
  | "invoice:read"
  | "invoice:write"
  | "pay:execute"
  | "receipt:read"
  | "compliance:check"
  | "reputation:read";

export type GeneratedApiKey = {
  rawKey: string;         // show ONCE
  id: string;
  prefix: string;
  scopes: ApiKeyScope[];
};

export type ApiKeyLookup = {
  id: string;
  userId: string;
  scopes: ApiKeyScope[];
  isTest: boolean;
};

function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeros = 0;
  for (const byte of bytes) {
    if (byte === 0) zeros++;
    else break;
  }
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const d = (digits[i] ?? 0) * 256 + carry;
      digits[i] = d % 58;
      carry = Math.floor(d / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => ALPHABET[d]).join("");
}

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function generateApiKey(args: {
  userId: string;
  name: string;
  scopes: ApiKeyScope[];
  env?: "live" | "test";
}): Promise<GeneratedApiKey> {
  const bytes = randomBytes(32);
  const envPrefix = args.env === "live" ? PREFIX_LIVE : PREFIX_TEST;
  const rawKey = `${envPrefix}${base58Encode(bytes)}`;
  const prefix = rawKey.slice(0, 16);

  const record = await prisma.apiKey.create({
    data: {
      userId: args.userId,
      prefix,
      keyHash: hashKey(rawKey),
      name: args.name,
      scopes: args.scopes.join(","),
    },
  });

  return {
    rawKey,
    id: record.id,
    prefix,
    scopes: args.scopes,
  };
}

export async function lookupApiKey(rawKey: string): Promise<ApiKeyLookup | null> {
  if (!rawKey.startsWith(PREFIX_LIVE) && !rawKey.startsWith(PREFIX_TEST)) return null;
  const keyHash = hashKey(rawKey);
  const row = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt <= new Date()) return null;

  // Opportunistic last-used update; don't await.
  void prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });

  return {
    id: row.id,
    userId: row.userId,
    scopes: row.scopes.split(",").filter(Boolean) as ApiKeyScope[],
    isTest: rawKey.startsWith(PREFIX_TEST),
  };
}

export async function revokeApiKey(id: string): Promise<void> {
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
}
