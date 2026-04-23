import { describe, it, expect } from "vitest";
import { buildOpenApiYaml } from "./openapi";

describe("buildOpenApiYaml", () => {
  const yaml = buildOpenApiYaml();

  it("returns a non-empty string", () => {
    expect(typeof yaml).toBe("string");
    expect(yaml.length).toBeGreaterThan(0);
  });

  it("declares OpenAPI 3.1", () => {
    // YAML has no quotes around 3.1.0 by default; match either form.
    expect(yaml).toMatch(/openapi:\s*['"]?3\.1\.0['"]?/);
  });

  it("lists at least 8 paths under /v1/", () => {
    const matches = yaml.match(/^\s{2}\/v1\/[^\s:]+:/gm) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(8);
  });

  it("includes the Problem+JSON envelope component", () => {
    expect(yaml).toContain("ProblemJsonResponse");
  });

  it("registers bearerAuth as a security scheme", () => {
    expect(yaml).toContain("bearerAuth");
    expect(yaml).toMatch(/scheme:\s*bearer/);
  });

  it("documents the four /api/admin/* paths", () => {
    expect(yaml).toMatch(/^\s{2}\/api\/admin\/keys:/m);
    expect(yaml).toMatch(/^\s{2}\/api\/admin\/observability:/m);
    // GET, POST and DELETE all live under /api/admin/keys; observability is GET-only.
    // Confirm the methods land in the YAML somewhere under the admin paths.
    const adminKeysBlock = yaml.split(/^\s{2}\/api\/admin\/keys:/m)[1] ?? "";
    const adminBlock = adminKeysBlock.split(/^\s{2}\//m)[0] ?? "";
    expect(adminBlock).toMatch(/\bget:/);
    expect(adminBlock).toMatch(/\bpost:/);
    expect(adminBlock).toMatch(/\bdelete:/);
  });

  it("registers adminToken as an apiKey security scheme", () => {
    expect(yaml).toContain("adminToken");
    expect(yaml).toMatch(/type:\s*apiKey/);
    expect(yaml).toContain("X-Admin-Token");
  });

  it("documents at least 17 operations across /v1/ and /api/admin/", () => {
    // Path objects in OpenAPI are keyed by URL string and may host multiple
    // method operations (e.g. /api/admin/keys has GET+POST+DELETE under one
    // entry). The meaningful surface measure is the operation count, not the
    // unique-URL count, so assert on emitted method verbs at the right indent.
    const operations = yaml.match(/^\s{4}(get|post|put|delete|patch):/gm) ?? [];
    expect(operations.length).toBeGreaterThanOrEqual(17);
  });
});
