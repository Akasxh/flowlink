// Minimal MCP-over-SSE handler. JSON-RPC 2.0 per MCP spec
// (https://modelcontextprotocol.io/specification). No SDK dependency.
//
// Supported methods:
//   - initialize             → returns protocolVersion / capabilities / serverInfo
//   - notifications/initialized → accept silently (no response)
//   - tools/list             → 10 FlowLink tools (6 v1 + 4 admin). Descriptions
//                              copied verbatim from public/.well-known/mcp.json.
//   - tools/call             → dispatch by name to handlers in mcp-tools.ts
//
// Admin tools (list/mint/revoke api keys, observability) carry an `admin: true`
// flag so clients can render them as dev-only. The MCP wire transport already
// authenticates via SIWE bearer; the flag is a hint, not a gate.
//
// Hard cap: < 300 LOC. No framework imports — `route.ts` wires this into Next.

import { TOOL_HANDLERS, type ToolName } from "./mcp-tools";

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_SERVER_INFO = { name: "flowlink", version: "1.0.0" } as const;

// JSON-RPC 2.0 error codes (subset used here)
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
};

export type JsonRpcError = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
};

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

// MCP tool catalogue. Descriptions copied verbatim from
// public/.well-known/mcp.json — keep these in sync.
//
// `admin: true` marks tools that wrap /api/admin/* (dev-only). Clients can
// surface this flag in their UI; the MCP spec permits arbitrary annotation
// fields on a Tool, and unknown clients ignore them.
export type McpTool = {
  name: ToolName;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  admin?: boolean;
};

const ALL_API_KEY_SCOPES_ENUM = [
  "invoice:read",
  "invoice:write",
  "pay:execute",
  "receipt:read",
  "compliance:check",
  "reputation:read",
] as const;

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "create_invoice",
    description: "Create an invoice with a stable invoice_id. See /skills/invoice.md.",
    inputSchema: {
      type: "object",
      properties: {
        receiver_address: { type: "string", description: "EIP-55 wallet receiving funds" },
        amount: { type: "string", description: "decimal string, e.g. \"10.50\"" },
        token: { type: "string", enum: ["USDC", "USDT", "HSK"] },
        purpose: { type: "string", description: "free-form note (max 500 chars)" },
      },
      required: ["receiver_address", "amount", "token"],
    },
  },
  {
    name: "get_invoice",
    description: "Fetch an invoice by id. See /skills/invoice.md.",
    inputSchema: {
      type: "object",
      properties: { invoice_id: { type: "string" } },
      required: ["invoice_id"],
    },
  },
  {
    name: "pay_invoice",
    description: "Settle an invoice via HSP Single-Pay mandate with inline OFAC screening. See /skills/pay.md.",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string" },
        payer_address: { type: "string", description: "EIP-55 wallet sending funds" },
        token: { type: "string", enum: ["USDC", "USDT", "HSK"] },
      },
      required: ["invoice_id", "payer_address"],
    },
  },
  {
    name: "check_sanctions",
    description: "OFAC + velocity screen a wallet address. Fails closed on upstream error. See /skills/compliance.md.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "EIP-55 address to screen" } },
      required: ["address"],
    },
  },
  {
    name: "get_receipt",
    description: "Fetch an ed25519-signed receipt for a settled transaction. See /skills/receipt.md.",
    inputSchema: {
      type: "object",
      properties: {
        receipt_id: { type: "string" },
        transaction_id: { type: "string" },
        invoice_id: { type: "string" },
      },
    },
  },
  {
    name: "get_reputation",
    description: "Query the counterparty reputation score for a wallet address. See /skills/reputation.md.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "EIP-55 address to score" } },
      required: ["address"],
    },
  },
  {
    name: "list_api_keys",
    description: "List minted API keys for the local admin user (sanitized — no raw key, no hash). Dev-only. See /skills/admin.md.",
    admin: true,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "mint_api_key",
    description: "Create a fresh scoped API key. The raw key is returned ONCE — persist immediately. Dev-only. See /skills/admin.md.",
    admin: true,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "human label, 1..80 chars" },
        scopes: {
          type: "array",
          items: { type: "string", enum: [...ALL_API_KEY_SCOPES_ENUM] },
          minItems: 1,
          description: "subset of the six FlowLink scopes",
        },
        env: { type: "string", enum: ["live", "test"], description: "default `test`" },
      },
      required: ["name", "scopes"],
    },
  },
  {
    name: "revoke_api_key",
    description: "Revoke a previously minted API key by id. Idempotent. Dev-only. See /skills/admin.md.",
    admin: true,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "ApiKey row id (e.g. ck_01HV...)" } },
      required: ["id"],
    },
  },
  {
    name: "query_observability",
    description: "Rolling /v1/* traffic summary: top fingerprints, latency p50/p95, status mix. Dev-only. See /skills/dashboard.md.",
    admin: true,
    inputSchema: {
      type: "object",
      properties: {
        windowSec: {
          type: "integer",
          description: "window in seconds (default 300, max 86400)",
          minimum: 1,
          maximum: 86_400,
        },
      },
    },
  },
];

function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, name);
}

function ok(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function err(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcError {
  const error: JsonRpcError["error"] = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

// `principal` is the authenticated FlowLink Principal (or a synthetic stand-in
// in tests). `null` is returned for notifications (one-way; no response sent).
//
// `adminTokenValid` is set by the route handler when the request also carried
// a valid `X-Admin-Token` header. Tools flagged `admin: true` REQUIRE this —
// SIWE auth alone is not enough to call admin operations (privilege escalation
// fix, round-2 reviewer P1).
export async function handleJsonRpc(
  message: unknown,
  ctx: { principalSubject: string; adminTokenValid?: boolean },
): Promise<JsonRpcResponse | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return err(null, RPC_INVALID_REQUEST, "request must be a JSON object");
  }
  const req = message as Partial<JsonRpcRequest>;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return err(req.id ?? null, RPC_INVALID_REQUEST, "missing jsonrpc=\"2.0\" or method");
  }
  const id: JsonRpcId = req.id ?? null;
  const isNotification = req.id === undefined;

  try {
    switch (req.method) {
      case "initialize":
        return ok(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: MCP_SERVER_INFO,
        });

      case "notifications/initialized":
        // One-way notification per MCP spec; no response.
        return null;

      case "tools/list":
        return ok(id, { tools: MCP_TOOLS });

      case "tools/call": {
        const params = (req.params ?? {}) as { name?: unknown; arguments?: unknown };
        if (typeof params.name !== "string") {
          return err(id, RPC_INVALID_PARAMS, "tools/call requires `name: string`");
        }
        if (!isToolName(params.name)) {
          return err(id, RPC_METHOD_NOT_FOUND, `unknown tool: ${params.name}`);
        }
        // Admin gate (round-2 reviewer P1): tools flagged `admin: true` require
        // a valid X-Admin-Token header in addition to SIWE auth. Without this,
        // any SIWE-authed agent could mint themselves an unrestricted API key.
        const tool = MCP_TOOLS.find((t) => t.name === params.name);
        if (tool?.admin && !ctx.adminTokenValid) {
          return err(
            id,
            RPC_INVALID_PARAMS,
            `admin tool '${params.name}' requires X-Admin-Token header on the MCP request`,
          );
        }
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        const handler = TOOL_HANDLERS[params.name];
        const result = await handler(args, ctx);
        return ok(id, result);
      }

      default:
        if (isNotification) return null; // ignore unknown notifications
        return err(id, RPC_METHOD_NOT_FOUND, `unknown method: ${req.method}`);
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return err(id, RPC_INTERNAL_ERROR, detail);
  }
}

// Encode a single JSON-RPC payload into the SSE wire format.
// MCP transport convention: `event: message\ndata: <json>\n\n`.
export function encodeSseFrame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function encodeSseComment(text: string): string {
  return `: ${text}\n\n`;
}
