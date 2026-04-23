// Minimal MCP-over-SSE handler. JSON-RPC 2.0 per MCP spec
// (https://modelcontextprotocol.io/specification). No SDK dependency.
//
// Supported methods:
//   - initialize             → returns protocolVersion / capabilities / serverInfo
//   - notifications/initialized → accept silently (no response)
//   - tools/list             → 6 FlowLink tools (descriptions copied verbatim
//                              from public/.well-known/mcp.json)
//   - tools/call             → dispatch by name to handlers in mcp-tools.ts
//
// Hard cap: < 250 LOC. No framework imports — `route.ts` wires this into Next.

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
export type McpTool = {
  name: ToolName;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

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
export async function handleJsonRpc(
  message: unknown,
  ctx: { principalSubject: string },
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
