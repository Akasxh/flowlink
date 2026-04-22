// Ed25519 JWTs. No external JWT library — RFC 7519 compact form is 3 base64url parts joined by ".".
// Signing key lives in env (JWT_SIGNING_KEY_HEX). Rotation is manual (document in runbook); old keys
// stay verifiable because the JWT's `kid` header selects the key via JWKS.
//
// Independent module: only depends on @noble/ed25519 + @noble/hashes. No Prisma, no other lib/*.

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

// @noble/ed25519 v2 needs sha512 explicitly injected for sync use.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

const ISSUER = "https://flowlink.ink";
const AUD = "flowlink.ink";

export type JwtPayload = {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  scopes: string[];
  auth_type: "siwe" | "api-key";
};

function b64urlEncode(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function getSigningKey(): Uint8Array {
  const hex = process.env.JWT_SIGNING_KEY_HEX;
  if (!hex || hex.length !== 64) {
    throw new Error("JWT_SIGNING_KEY_HEX missing or wrong length (expect 64 hex chars = 32 bytes)");
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function currentKeyId(): string {
  const now = new Date();
  const yyyymm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `flk-${yyyymm}`;
}

export async function signAccessToken(args: {
  subject: string;
  scopes: string[];
  authType: "siwe" | "api-key";
  ttlSec?: number;
  jti: string;
}): Promise<string> {
  const ttl = args.ttlSec ?? 3600;
  const iat = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    iss: ISSUER,
    sub: args.subject,
    aud: AUD,
    iat,
    exp: iat + ttl,
    jti: args.jti,
    scopes: args.scopes,
    auth_type: args.authType,
  };
  const header = { alg: "EdDSA", typ: "JWT", kid: currentKeyId() };
  const headerB64 = b64urlEncode(JSON.stringify(header));
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = getSigningKey();
  const sig = await ed.signAsync(new TextEncoder().encode(signingInput), key);
  return `${signingInput}.${b64urlEncode(sig)}`;
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed_jwt");
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = b64urlDecode(sigB64);
  const privKey = getSigningKey();
  const pubKey = await ed.getPublicKeyAsync(privKey);
  const ok = await ed.verifyAsync(new Uint8Array(sig), new TextEncoder().encode(signingInput), pubKey);
  if (!ok) throw new Error("invalid_signature");

  const payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as JwtPayload;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) throw new Error("token_expired");
  if (payload.iss !== ISSUER || payload.aud !== AUD) throw new Error("invalid_audience");
  return payload;
}

// Public key for JWKS publication.
export async function publicKeyHex(): Promise<string> {
  const priv = getSigningKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return Buffer.from(pub).toString("hex");
}

export async function jwks(): Promise<{ keys: Array<Record<string, string>> }> {
  const priv = getSigningKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return {
    keys: [
      {
        kty: "OKP",
        crv: "Ed25519",
        kid: currentKeyId(),
        use: "sig",
        alg: "EdDSA",
        x: Buffer.from(pub).toString("base64url"),
      },
    ],
  };
}
