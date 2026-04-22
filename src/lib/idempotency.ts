// Idempotency middleware for POST/PUT/DELETE /v1/* routes.
//
// Contract:
//   - Clients must send `Idempotency-Key: <ULID>` on every write.
//   - Same key + same canonical body within 24h → replay stored response.
//   - Same key + different body → 409 idempotency_conflict.
//   - Keys are scoped to the authenticated principal (apiKey id or SIWE sub).
//
// This module only depends on Prisma and Web Crypto (hash). No cross-lib imports.

import { createHash } from "node:crypto";
import { prisma } from "./prisma";

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export type IdempotencyLookup =
  | { kind: "miss"; keyHash: string; requestHash: string }
  | { kind: "hit"; response: unknown; statusCode: number }
  | { kind: "conflict" };

export type IdempotencyArgs = {
  principal: string; // principal id (apiKey id, jti, or address)
  rawKey: string;
  method: string;
  path: string;
  body: string; // canonical JSON string (or "")
};

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function computeHashes(args: IdempotencyArgs) {
  const keyHash = sha256(`${args.principal}|${args.rawKey}`);
  const requestHash = sha256(`${args.method}|${args.path}|${args.body}`);
  return { keyHash, requestHash };
}

export async function lookup(args: IdempotencyArgs): Promise<IdempotencyLookup> {
  const { keyHash, requestHash } = computeHashes(args);

  const existing = await prisma.idempotencyKey.findUnique({ where: { keyHash } });
  if (!existing) return { kind: "miss", keyHash, requestHash };
  if (existing.expiresAt <= new Date()) {
    // Expired — safe to overwrite on save.
    return { kind: "miss", keyHash, requestHash };
  }
  if (existing.requestHash !== requestHash) return { kind: "conflict" };

  return {
    kind: "hit",
    response: JSON.parse(existing.response),
    statusCode: existing.statusCode,
  };
}

export async function save(
  keyHash: string,
  requestHash: string,
  response: unknown,
  statusCode: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + WINDOW_MS);
  const payload = JSON.stringify(response);
  await prisma.idempotencyKey.upsert({
    where: { keyHash },
    create: { keyHash, requestHash, response: payload, statusCode, expiresAt },
    update: { requestHash, response: payload, statusCode, expiresAt },
  });
}

// Canonical JSON serializer — sort keys so same-object-different-order bodies hash identically.
export function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(",")}]`;
  const entries = Object.entries(obj as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

// Cleanup — call from a cron (weekly). Not on the request path.
export async function purgeExpired(): Promise<number> {
  const result = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return result.count;
}
