// SIWE (Sign-In With Ethereum, EIP-4361) flow.
//
// 1. POST /v1/auth/siwe/nonce  { address }
//    → server stores a single-use nonce with 5-minute TTL, returns the message template
// 2. Client signs the message locally
// 3. POST /v1/auth/siwe/verify { message, signature }
//    → server verifies, consumes the nonce, returns a JWT
//
// This module depends on the siwe package + Prisma (for nonce store). It does NOT import
// auth/jwt.ts — JWT issuance happens at the route level, keeping this module narrowly focused
// on the nonce/verify verbs.

import { SiweMessage, generateNonce } from "siwe";
import { getAddress } from "viem";
import { prisma } from "../prisma";

const NONCE_TTL_SEC = 5 * 60;
const DEFAULT_DOMAIN = "flowlink.ink";
// EIP-4361 ABNF grammar restricts statement to printable ASCII. The em-dash
// (U+2014) we originally used caused siwe's post-generation validator to reject
// every message with state:103 / maxMatched:167. Round-3 agent round3-siwe caught
// this via HTTP 500 on every nonce call.
const DEFAULT_STATEMENT =
  "Sign in to FlowLink. This request is for authentication only - it will not trigger any on-chain transaction.";

export type NonceIssue = {
  nonce: string;
  message: string;
  domain: string;
  uri: string;
  chainId: number;
  issuedAt: string;
  expiresAt: string;
};

export async function issueNonce(args: {
  address: string;
  domain?: string;
  uri?: string;
  chainId?: number;
}): Promise<NonceIssue> {
  // SIWE requires the address in EIP-55 checksum form. Round-3 agent round3-siwe
  // caught a P0 bug where we were passing lowercased/unchecksummed addresses into
  // SiweMessage, causing the library's own validator to reject the generated
  // message — surfacing as HTTP 500 on every /v1/auth/siwe/nonce call.
  let checksummedAddress: `0x${string}`;
  try {
    checksummedAddress = getAddress(args.address);
  } catch (err) {
    throw new Error(
      `invalid_address: ${args.address} is not a valid EVM address (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const nonce = generateNonce();
  const issuedAtDate = new Date();
  const expiresAtDate = new Date(issuedAtDate.getTime() + NONCE_TTL_SEC * 1000);
  const domain = args.domain ?? DEFAULT_DOMAIN;
  const uri = args.uri ?? `https://${domain}`;
  const chainId = args.chainId ?? 133;

  const message = new SiweMessage({
    domain,
    address: checksummedAddress,
    statement: DEFAULT_STATEMENT,
    uri,
    version: "1",
    chainId,
    nonce,
    issuedAt: issuedAtDate.toISOString(),
    expirationTime: expiresAtDate.toISOString(),
  }).prepareMessage();

  await prisma.siweNonce.create({
    data: {
      address: checksummedAddress.toLowerCase(), // store lowercase for case-insensitive lookup on verify
      nonce,
      expiresAt: expiresAtDate,
    },
  });

  return {
    nonce,
    message,
    domain,
    uri,
    chainId,
    issuedAt: issuedAtDate.toISOString(),
    expiresAt: expiresAtDate.toISOString(),
  };
}

export type VerifiedSiwe = {
  address: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
};

export async function verifySiwe(args: {
  message: string;
  signature: string;
}): Promise<VerifiedSiwe> {
  const siwe = new SiweMessage(args.message);
  const result = await siwe.verify({ signature: args.signature });
  if (!result.success) {
    throw new Error("signature_invalid");
  }
  const nonceRow = await prisma.siweNonce.findUnique({ where: { nonce: siwe.nonce } });
  if (!nonceRow) throw new Error("nonce_unknown");
  if (nonceRow.consumed) throw new Error("nonce_reused");
  if (nonceRow.expiresAt <= new Date()) throw new Error("nonce_expired");
  if (nonceRow.address.toLowerCase() !== siwe.address.toLowerCase()) {
    throw new Error("nonce_address_mismatch");
  }

  await prisma.siweNonce.update({
    where: { nonce: siwe.nonce },
    data: { consumed: true },
  });

  return {
    address: siwe.address,
    chainId: siwe.chainId,
    nonce: siwe.nonce,
    issuedAt: siwe.issuedAt ?? new Date().toISOString(),
  };
}

export async function purgeExpiredNonces(): Promise<number> {
  const result = await prisma.siweNonce.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return result.count;
}
