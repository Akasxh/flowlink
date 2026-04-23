// /i/{id}/agent — markdown view of an invoice for autonomous agents.
//
// Public read (no auth) — the invoice is meant to be discovered + paid via QR.
// Returns 404 (text/plain) if the invoice does not exist.
// All payment instructions reference /skills/pay.md as the canonical spec.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

type Props = { params: { id: string } };

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function GET(_req: NextRequest, ctx: Props) {
  const inv = await prisma.invoice.findUnique({ where: { id: ctx.params.id } });
  if (!inv) {
    return new Response(`# 404\n\nNo invoice with id ${ctx.params.id}.\nSee /skills/invoice.md.\n`, {
      status: 404,
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  const url = APP_URL();
  const md = `---
flowlink_invoice_id: ${inv.id}
flowlink_id: ${inv.flowlinkId}
amount: "${inv.amount}"
token: ${inv.token}
chain_id: ${inv.chainId}
receiver_address: ${inv.receiverAddress}
status: ${inv.status}
due_at: ${inv.dueAt.toISOString()}
created_at: ${inv.createdAt.toISOString()}
human_alternate: ${url}/i/${inv.id}
spec: ${url}/skills/pay.md
discovery: ${url}/llms.txt
---

# ${inv.purpose ?? "FlowLink invoice"}

Pay **${inv.amount} ${inv.token}** on HashKey Chain (id ${inv.chainId}) to ${inv.receiverAddress}.

## How to pay (one HTTPS call)

\`\`\`http
POST /v1/pay HTTP/1.1
Host: flowlink.ink
Authorization: Bearer <your JWT or flk_test_*>
Idempotency-Key: <fresh ULID>
Content-Type: application/json

{
  "invoice_id": "${inv.id}",
  "payer_address": "<your wallet>",
  "token": "${inv.token}"
}
\`\`\`

Don't have a JWT? Run the SIWE flow first:

\`\`\`http
POST /v1/auth/siwe/nonce  {"address":"<your wallet>"}
# sign the returned EIP-4361 message
POST /v1/auth/siwe/verify {"message":"...","signature":"0x..."}
\`\`\`

Full spec: [/skills/pay.md](${url}/skills/pay.md). Compliance preflight: [/skills/compliance.md](${url}/skills/compliance.md). Errors catalogue: [/skills/errors.md](${url}/skills/errors.md).

## Settlement

The pay endpoint returns a \`transaction_id\`. Subscribe to events with SSE:

\`\`\`http
GET /v1/transactions/{transaction_id}/events
Accept: text/event-stream
\`\`\`

Watch for the \`receipt_ready\` event; then \`GET /v1/receipts/{receipt_id}\` to get the ed25519-signed proof, verifiable against [/.well-known/flowlink-receipt-pubkey.pem](${url}/.well-known/flowlink-receipt-pubkey.pem).

## Status

Currently **${inv.status}**. ${inv.status === "paid" ? `Paid at ${inv.paidAt?.toISOString()}.` : `Due ${inv.dueAt.toISOString().slice(0, 10)}.`}

## Audit

This invoice was issued by FlowLink and screened against OFAC + velocity at create time. The receiver address has been compliance-verified — see [/skills/compliance.md](${url}/skills/compliance.md) for the methodology.
`;

  return new Response(md, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=30, s-maxage=60",
      Link: `<${url}/i/${inv.id}>; rel="canonical", </skills/pay.md>; rel="describedby"`,
    },
  });
}
