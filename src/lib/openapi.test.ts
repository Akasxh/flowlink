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
});
