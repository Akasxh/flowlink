// GET /.well-known/openapi.yaml — public OpenAPI 3.1 spec.
//
// The spec is built once on the first request and cached in module scope.
// In Next.js App Router this means the spec lives for the lifetime of the
// serverless instance / dev process, which is what we want — it's pure and
// stable across requests.

import { NextRequest } from "next/server";
import { buildOpenApiYaml } from "@/lib/openapi";

let cached: string | null = null;

function getSpec(): string {
  if (cached === null) cached = buildOpenApiYaml();
  return cached;
}

export async function GET(_req: NextRequest) {
  const body = getSpec();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
