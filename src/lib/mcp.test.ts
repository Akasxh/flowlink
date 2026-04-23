import { describe, it, expect } from "vitest";
import {
  encodeSseComment,
  encodeSseFrame,
  handleJsonRpc,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_TOOLS,
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
} from "./mcp";

const CTX = { principalSubject: "test_user" };

describe("MCP handleJsonRpc — initialize", () => {
  it("returns protocolVersion, capabilities, serverInfo", async () => {
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      CTX,
    );
    expect(res).not.toBeNull();
    expect(res).toHaveProperty("result");
    if (!res || !("result" in res)) throw new Error("expected success");
    const result = res.result as {
      protocolVersion: string;
      capabilities: Record<string, unknown>;
      serverInfo: { name: string; version: string };
    };
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.serverInfo).toEqual(MCP_SERVER_INFO);
    expect(result.capabilities).toHaveProperty("tools");
    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe(1);
  });
});

describe("MCP handleJsonRpc — tools/list", () => {
  it("returns the 10 FlowLink tools (6 v1 + 4 admin)", async () => {
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", id: "abc", method: "tools/list" },
      CTX,
    );
    if (!res || !("result" in res)) throw new Error("expected success");
    const result = res.result as { tools: Array<{ name: string; description: string; inputSchema: unknown; admin?: boolean }> };
    expect(result.tools).toHaveLength(10);
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "check_sanctions",
      "create_invoice",
      "get_invoice",
      "get_receipt",
      "get_reputation",
      "list_api_keys",
      "mint_api_key",
      "pay_invoice",
      "query_observability",
      "revoke_api_key",
    ]);
    for (const tool of result.tools) {
      expect(tool.description).toMatch(/See \/skills\//);
      expect(tool.inputSchema).toHaveProperty("type", "object");
      expect(tool.inputSchema).toHaveProperty("properties");
    }
    // 4 admin-flagged tools
    const adminTools = result.tools.filter((t) => t.admin === true).map((t) => t.name).sort();
    expect(adminTools).toEqual(["list_api_keys", "mint_api_key", "query_observability", "revoke_api_key"]);
  });

  it("MCP_TOOLS catalogue is internally consistent", () => {
    expect(MCP_TOOLS).toHaveLength(10);
    for (const t of MCP_TOOLS) {
      expect(typeof t.name).toBe("string");
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("admin tools require adminTokenValid in ctx (P1 reviewer fix)", async () => {
    // Without adminTokenValid → tools/call on admin tool returns RPC_INVALID_PARAMS
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", id: "x", method: "tools/call", params: { name: "list_api_keys", arguments: {} } },
      CTX, // no adminTokenValid
    );
    if (!res || !("error" in res)) throw new Error("expected RPC error");
    expect(res.error.message).toMatch(/admin tool.*requires X-Admin-Token/);
  });
});

describe("MCP handleJsonRpc — tools/call error paths", () => {
  it("returns method-not-found for an unknown tool name", async () => {
    const res = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "definitely_not_a_real_tool", arguments: {} },
      },
      CTX,
    );
    if (!res || !("error" in res)) throw new Error("expected error");
    expect(res.error.code).toBe(RPC_METHOD_NOT_FOUND);
    expect(res.error.message).toContain("definitely_not_a_real_tool");
    expect(res.id).toBe(7);
    expect(res.jsonrpc).toBe("2.0");
  });

  it("returns invalid-params when name is missing", async () => {
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { arguments: {} } },
      CTX,
    );
    if (!res || !("error" in res)) throw new Error("expected error");
    expect(res.error.code).toBe(RPC_INVALID_PARAMS);
  });
});

describe("MCP handleJsonRpc — notifications and validity", () => {
  it("notifications/initialized returns null (no response)", async () => {
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      CTX,
    );
    expect(res).toBeNull();
  });

  it("rejects messages without jsonrpc=\"2.0\"", async () => {
    const res = await handleJsonRpc({ id: 1, method: "initialize" }, CTX);
    if (!res || !("error" in res)) throw new Error("expected error");
    expect(res.error.code).toBe(RPC_INVALID_REQUEST);
  });

  it("rejects non-object messages", async () => {
    const res = await handleJsonRpc("not an object", CTX);
    if (!res || !("error" in res)) throw new Error("expected error");
    expect(res.error.code).toBe(RPC_INVALID_REQUEST);
  });

  it("returns method-not-found for an unknown method (with id)", async () => {
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", id: 99, method: "totally/unknown" },
      CTX,
    );
    if (!res || !("error" in res)) throw new Error("expected error");
    expect(res.error.code).toBe(RPC_METHOD_NOT_FOUND);
  });
});

describe("MCP SSE encoders", () => {
  it("encodeSseFrame produces a `message` event with JSON data", () => {
    const out = encodeSseFrame({ hello: "world" });
    expect(out).toBe('event: message\ndata: {"hello":"world"}\n\n');
  });

  it("encodeSseComment produces a comment line", () => {
    expect(encodeSseComment("ping")).toBe(": ping\n\n");
  });
});
