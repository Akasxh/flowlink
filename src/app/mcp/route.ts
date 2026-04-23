// MCP-over-SSE endpoint.
//
// GET  /mcp → text/event-stream
//   * emits an `endpoint` event with the POST URL (per MCP SSE transport spec)
//   * keeps the connection alive with periodic SSE comment heartbeats
//   * closes when the client aborts (Next dev hot-reload safe)
// POST /mcp → JSON-RPC 2.0 request/response
//   * Content-Type: application/json on the response (cheaper for one-shot
//     agents; MCP spec permits JSON when the client did not initiate an SSE
//     channel for this request).
//   * Returns 204 No Content for one-way notifications.
//
// Auth: Bearer token via authenticate() — 401 Problem+JSON when missing.

import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { authenticate } from "@/lib/auth/middleware";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";

// Constant-time string compare to prevent admin-token timing attacks.
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
import {
  encodeSseComment,
  encodeSseFrame,
  handleJsonRpc,
  RPC_PARSE_ERROR,
} from "@/lib/mcp";

// Force dynamic — SSE streams are not cacheable and we read auth headers per req.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no", // disable nginx proxy buffering
} as const;

const HEARTBEAT_MS = 15_000;

export async function GET(req: NextRequest) {
  const requestId = getOrMintRequestId(req);
  const principal = await authenticate(req);
  if (!principal) {
    return problemJson({ code: "auth_required", instance: "/mcp", requestId });
  }

  const encoder = new TextEncoder();
  const url = new URL(req.url);
  const endpointUrl = `${url.origin}/mcp`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Per MCP SSE transport spec, server must immediately send an `endpoint`
      // event so the client knows where to POST messages.
      controller.enqueue(
        encoder.encode(`event: endpoint\ndata: ${JSON.stringify(endpointUrl)}\n\n`),
      );
      controller.enqueue(encoder.encode(encodeSseComment(`request_id=${requestId}`)));

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(encodeSseComment("keepalive")));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);

      const onAbort = () => {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", onAbort, { once: true });
    },
  });

  return new Response(stream, { status: 200, headers: { ...SSE_HEADERS, "X-Request-Id": requestId } });
}

export async function POST(req: NextRequest) {
  const requestId = getOrMintRequestId(req);
  try {
    const principal = await authenticate(req);
    if (!principal) {
      return problemJson({ code: "auth_required", instance: "/mcp", requestId });
    }

    const raw = await req.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw || "null");
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const errPayload = {
        jsonrpc: "2.0" as const,
        id: null,
        error: { code: RPC_PARSE_ERROR, message: `parse error: ${detail}` },
      };
      return new Response(JSON.stringify(errPayload), {
        status: 200, // JSON-RPC errors travel inside a 200 envelope
        headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      });
    }

    // Admin-token check (round-2 reviewer P1 fix): tools flagged `admin: true`
    // require BOTH a valid SIWE bearer AND a matching X-Admin-Token header.
    // Compare in constant time to avoid token-prefix probing.
    const adminTokenHdr = req.headers.get("x-admin-token") ?? "";
    const adminTokenEnv = process.env.ADMIN_TOKEN ?? "";
    const adminTokenValid =
      adminTokenEnv.length > 0 &&
      adminTokenHdr.length === adminTokenEnv.length &&
      timingSafeEqualStr(adminTokenHdr, adminTokenEnv);

    const response = await handleJsonRpc(parsed, {
      principalSubject: principal.subject,
      adminTokenValid,
    });

    // Notification → no response body
    if (response === null) {
      return new Response(null, { status: 204, headers: { "X-Request-Id": requestId } });
    }

    // If the client signalled an SSE preference via Accept, frame the reply as
    // an SSE event. Otherwise return JSON inline (default; compatible with the
    // streamable-HTTP variant of MCP).
    const accept = req.headers.get("accept") ?? "";
    if (accept.includes("text/event-stream")) {
      const body = encodeSseFrame(response);
      return new Response(body, {
        status: 200,
        headers: { ...SSE_HEADERS, "X-Request-Id": requestId },
      });
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    });
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}

// CORS preflight — agents calling from browsers (Claude Desktop / web hosts)
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
    },
  });
}
