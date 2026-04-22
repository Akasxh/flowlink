// HSP (HashKey Settlement Protocol) client.
//
// Graceful degradation: if HSP_APP_KEY / HSP_APP_SECRET are missing, `isConfigured()`
// returns false and callers short-circuit with a diagnostic (not a crash). Compliance,
// receipts, and invoice CRUD all still work — the /v1/pay route just returns
// "hsp_upstream_error" with detail "HSP not configured" in that case.
//
// HMAC-SHA256 signing per HSP spec. This is intentionally standalone — no other lib/*
// module imports it.

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type HspConfig = {
  appKey: string;
  appSecret: string;
  baseUrl: string;
  webhookSecret: string;
};

function readEnv(): Partial<HspConfig> {
  return {
    appKey: process.env.HSP_APP_KEY,
    appSecret: process.env.HSP_APP_SECRET,
    baseUrl: process.env.HSP_BASE_URL ?? "https://api-testnet.hsp.hashkey.com",
    webhookSecret: process.env.HSP_WEBHOOK_SECRET,
  };
}

export function isConfigured(): boolean {
  const env = readEnv();
  return Boolean(env.appKey && env.appSecret);
}

function requireConfig(): HspConfig {
  const env = readEnv();
  if (!env.appKey || !env.appSecret) {
    throw new Error("hsp_not_configured");
  }
  return {
    appKey: env.appKey,
    appSecret: env.appSecret,
    baseUrl: env.baseUrl ?? "https://api-testnet.hsp.hashkey.com",
    webhookSecret: env.webhookSecret ?? "",
  };
}

// HMAC signing contract:
//   signing-string = method + "\n" + sha256(body) + "\n" + ts + "\n" + nonce
//   signature = base64(hmac-sha256(secret, signing-string))
function sign(args: {
  method: string;
  path: string;
  body: string;
  timestamp: string;
  nonce: string;
  secret: string;
}): string {
  const bodyHash = createHash("sha256").update(args.body).digest("hex");
  const signingString = [args.method, args.path, bodyHash, args.timestamp, args.nonce].join("\n");
  return createHmac("sha256", args.secret).update(signingString).digest("base64");
}

export type MandateRequest = {
  merchantOrderId: string;
  amount: string;
  token: "USDC" | "USDT" | "HSK";
  chainId: number;
  webhookUrl: string;
  redirectUrl: string;
  description?: string;
};

export type MandateResponse = {
  cart_mandate_id: string;
  checkout_url: string;
  status: string;
};

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const cfg = requireConfig();
  const bodyStr = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const signature = sign({
    method: "POST",
    path,
    body: bodyStr,
    timestamp,
    nonce,
    secret: cfg.appSecret,
  });
  const resp = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-Key": cfg.appKey,
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Signature": signature,
    },
    body: bodyStr,
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`hsp ${resp.status}: ${txt}`);
  }
  const wrapped = (await resp.json()) as { code: number; message: string; data: T };
  if (wrapped.code !== 0 && wrapped.code !== 200) {
    throw new Error(`hsp code=${wrapped.code}: ${wrapped.message}`);
  }
  return wrapped.data;
}

export async function createSinglePayMandate(req: MandateRequest): Promise<MandateResponse> {
  return post<MandateResponse>("/api/v1/public/cartmandate", {
    merchant_order_id: req.merchantOrderId,
    amount: req.amount,
    token: req.token,
    chain_id: req.chainId,
    webhook_url: req.webhookUrl,
    redirect_url: req.redirectUrl,
    description: req.description,
  });
}

// ── Webhook verification (inbound HSP → FlowLink) ─────────────────────

export type WebhookHeaders = {
  timestamp: string;
  nonce: string;
  signature: string;
};

export function verifyWebhookSignature(args: {
  method: string;
  path: string;
  body: string;
  headers: WebhookHeaders;
}): boolean {
  const cfg = readEnv();
  if (!cfg.webhookSecret) return false;

  // Replay protection: ±5 min
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(args.headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;

  const expected = sign({
    method: args.method,
    path: args.path,
    body: args.body,
    timestamp: args.headers.timestamp,
    nonce: args.headers.nonce,
    secret: cfg.webhookSecret,
  });

  const a = Buffer.from(expected);
  const b = Buffer.from(args.headers.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
