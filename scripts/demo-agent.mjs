// End-to-end demo: a fresh agent walks FlowLink's entire agent-native surface.
//
// Flow:
//   1. Discovery: fetch /llms.txt, then 2 skill files
//   2. SIWE auth: nonce → sign (viem) → verify → JWT
//   3. Compliance check on the agent's own wallet
//   4. Create an invoice
//   5. Read it back
//   6. Pay it (HSP mandate creation; degrades gracefully without HSP creds)
//   7. Fetch transaction state + events
//
// Every HTTP exchange is logged with method, path, status, bytes, request-id.
// Output goes to stdout AND pitch/demo-live-run.log so the run is reproducible.

import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const BASE = process.env.FLOWLINK_URL ?? "http://localhost:3000";

const logPath = resolve(repoRoot, "pitch/demo-live-run.log");
if (!existsSync(dirname(logPath))) mkdirSync(dirname(logPath), { recursive: true });
const logLines = [];

function log(...args) {
  const line = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2)))
    .join(" ");
  console.log(line);
  logLines.push(line);
}

function banner(title) {
  log("");
  log("─".repeat(78));
  log(`▶ ${title}`);
  log("─".repeat(78));
}

async function http(method, path, opts = {}) {
  const url = `${BASE}${path}`;
  const body = opts.body ? JSON.stringify(opts.body) : undefined;
  const headers = {
    Accept: "application/json",
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers ?? {}),
  };
  const t0 = Date.now();
  const res = await fetch(url, { method, headers, body });
  const dt = Date.now() - t0;
  const text = await res.text();
  const bytes = Buffer.byteLength(text);
  const reqId = res.headers.get("x-request-id") ?? "-";
  log(`  ${method.padEnd(4)} ${path.padEnd(42)} ${String(res.status).padEnd(4)} ${String(bytes).padStart(5)}B ${dt}ms  req=${reqId}`);
  let parsed = null;
  try {
    parsed = text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, raw: text, bytes, headers: res.headers };
}

async function main() {
  const metrics = { calls: 0, bytes: 0, t0: Date.now() };

  // Wrap http() for metric accounting
  const realHttp = http;
  const track = async (...args) => {
    const r = await realHttp(...args);
    metrics.calls += 1;
    metrics.bytes += r.bytes;
    return r;
  };

  banner("Phase 1 · Discovery — agent reads the website");
  const llms = await track("GET", "/llms.txt");
  log(`    → ${String(llms.body).split("\n").length} lines of index; agent finds 6 skills + mcp manifest\n`);

  const invoiceMd = await track("GET", "/skills/invoice.md");
  const payMd = await track("GET", "/skills/pay.md");
  const errorsMd = await track("GET", "/skills/errors.md");
  log(`    → 3 skill files fetched, ~${Math.round((invoiceMd.bytes + payMd.bytes + errorsMd.bytes) / 1024)}KB total`);

  banner("Phase 2 · SIWE auth");
  const privKey = generatePrivateKey();
  const account = privateKeyToAccount(privKey);
  log(`  generated test wallet:  ${account.address}`);

  const nonceRes = await track("POST", "/v1/auth/siwe/nonce", {
    body: { address: account.address },
  });
  if (nonceRes.status !== 200) {
    log("  ✗ nonce endpoint failed");
    log(`    ${JSON.stringify(nonceRes.body, null, 2)}`);
    return finish(metrics);
  }
  const { nonce, message, expires_in, chain_id } = nonceRes.body;
  log(`  got nonce=${nonce} expires_in=${expires_in}s chain_id=${chain_id}`);

  const signature = await account.signMessage({ message });
  log(`  signed EIP-4361 message (sig ${signature.slice(0, 18)}…)`);

  const verifyRes = await track("POST", "/v1/auth/siwe/verify", {
    body: { message, signature },
  });
  if (verifyRes.status !== 200) {
    log("  ✗ verify failed");
    log(`    ${JSON.stringify(verifyRes.body, null, 2)}`);
    return finish(metrics);
  }
  const { access_token, scopes, subject } = verifyRes.body;
  log(`  got JWT, scopes=${scopes.join(",")}  subject=${subject.slice(0, 10)}…`);
  const authH = { Authorization: `Bearer ${access_token}` };

  banner("Phase 3 · Compliance check on the wallet");
  const compRes = await track("POST", "/v1/compliance/check", {
    body: { address: account.address },
  });
  log(`  sanctions_ok=${compRes.body?.sanctions_ok ?? "n/a"}  score=${compRes.body?.score ?? "n/a"}  source=${compRes.body?.sources?.join(",")}`);

  banner("Phase 4 · Compliance — Tornado Cash address (expect 403)");
  const sdnRes = await track("POST", "/v1/compliance/check", {
    body: { address: "0x8589427373D6D84E98730D7795D8f6f8731FDA16" },
  });
  log(`  status=${sdnRes.status}  code=${sdnRes.body?.code ?? "n/a"}  action="${sdnRes.body?.agent_action ?? ""}"`);

  banner("Phase 5 · Create an invoice");
  // Use a different wallet as receiver (any clean address)
  const receiverAccount = privateKeyToAccount(generatePrivateKey());
  log(`  receiver wallet: ${receiverAccount.address}`);
  const idemInv = `demo-inv-${randomBytes(6).toString("hex")}`;
  const invRes = await track("POST", "/v1/invoices", {
    headers: { ...authH, "Idempotency-Key": idemInv },
    body: {
      receiver_address: receiverAccount.address,
      amount: "10.00",
      token: "USDC",
      purpose: "Demo invoice — end-to-end agent flow",
    },
  });
  if (invRes.status !== 201) {
    log(`  ✗ invoice create returned ${invRes.status}`);
    log(`    ${JSON.stringify(invRes.body, null, 2)}`);
    return finish(metrics);
  }
  const invoiceId = invRes.body.invoice_id;
  log(`  ✓ created invoice_id=${invoiceId}  status=${invRes.body.status}  flowlink_id=${invRes.body.flowlink_id}`);

  banner("Phase 6 · Read the invoice back");
  const readRes = await track("GET", `/v1/invoices/${invoiceId}`, { headers: authH });
  log(`  status=${readRes.body?.status}  amount=${readRes.body?.amount} ${readRes.body?.token}  due_at=${readRes.body?.due_at}`);

  banner("Phase 7 · Idempotency proof — replay same POST with same key");
  const replayRes = await track("POST", "/v1/invoices", {
    headers: { ...authH, "Idempotency-Key": idemInv },
    body: {
      receiver_address: receiverAccount.address,
      amount: "10.00",
      token: "USDC",
      purpose: "Demo invoice — end-to-end agent flow",
    },
  });
  const replayed = replayRes.headers.get("idempotent-replayed");
  log(`  replayed=${replayed}  invoice_id=${replayRes.body?.invoice_id}  (matches? ${replayRes.body?.invoice_id === invoiceId})`);

  banner("Phase 8 · Pay the invoice");
  const idemPay = `demo-pay-${randomBytes(6).toString("hex")}`;
  const payRes = await track("POST", "/v1/pay", {
    headers: { ...authH, "Idempotency-Key": idemPay },
    body: {
      invoice_id: invoiceId,
      payer_address: account.address,
      token: "USDC",
    },
  });
  log(`  status=${payRes.status}`);
  if (payRes.body && typeof payRes.body === "object") {
    log(`    transaction_id=${payRes.body.transaction_id ?? payRes.body.code}`);
    log(`    hsp_configured=${payRes.body.hsp_configured}  status=${payRes.body.status}`);
    if (payRes.body.compliance) {
      log(`    compliance score=${payRes.body.compliance.score}  ok=${payRes.body.compliance.sanctions_ok}`);
    }
    if (payRes.body.code) {
      log(`    code=${payRes.body.code}  action="${payRes.body.agent_action ?? ""}"`);
    }
  }

  if (payRes.body?.transaction_id) {
    banner("Phase 9 · Read transaction state");
    const txnRes = await track("GET", `/v1/transactions/${payRes.body.transaction_id}`, { headers: authH });
    log(`  status=${txnRes.body?.status}  events=${txnRes.body?.events?.length ?? 0}`);
    for (const e of txnRes.body?.events ?? []) {
      log(`    ${e.at}  ${e.type}  ${JSON.stringify(e.data)}`);
    }
  }

  finish(metrics);
}

function finish(metrics) {
  const dt = Date.now() - metrics.t0;
  banner("Demo complete");
  log(`  http calls:  ${metrics.calls}`);
  log(`  bytes fetched total: ${metrics.bytes.toLocaleString()}`);
  log(`  wall clock: ${(dt / 1000).toFixed(1)}s`);
  log("");
  log(`  full log saved to: ${logPath}`);
  writeFileSync(logPath, logLines.join("\n") + "\n");
}

main().catch((err) => {
  log("");
  log("FATAL:", err instanceof Error ? err.stack ?? err.message : String(err));
  finish({ calls: 0, bytes: 0, t0: Date.now() });
  process.exit(1);
});
