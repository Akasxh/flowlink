import { describe, it, expect } from "vitest";
import { problemJson } from "./errors";

describe("problemJson", () => {
  it("emits RFC 9457 Problem+JSON for a known code", async () => {
    const res = problemJson({ code: "invoice_not_found", detail: "id=inv_x", requestId: "req_1" });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("x-request-id")).toBe("req_1");
    const body = await res.json();
    expect(body.code).toBe("invoice_not_found");
    expect(body.type).toBe("https://flowlink.ink/errors/invoice_not_found");
    expect(body.agent_action).toContain("Verify invoice_id");
    expect(body.request_id).toBe("req_1");
  });

  it("sets Retry-After header when retryAfter is provided", async () => {
    const res = problemJson({ code: "rate_limited", retryAfter: 30 });
    expect(res.headers.get("retry-after")).toBe("30");
    const body = await res.json();
    expect(body.retry_after).toBe(30);
  });

  it("every code maps to a title + agentAction", async () => {
    const codes = [
      "auth_required",
      "token_expired",
      "validation_error",
      "invoice_not_found",
      "invoice_already_paid",
      "compliance_blocked_sanctions",
      "compliance_upstream_unavailable",
      "rate_limited",
      "internal_error",
    ] as const;
    for (const code of codes) {
      const res = problemJson({ code });
      const body = await res.json();
      expect(body.code).toBe(code);
      expect(typeof body.title).toBe("string");
      expect(body.title.length).toBeGreaterThan(0);
      expect(typeof body.agent_action).toBe("string");
      expect(body.agent_action.length).toBeGreaterThan(0);
    }
  });
});
