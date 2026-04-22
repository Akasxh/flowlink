import { jwks } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const keys = await jwks();
    return new Response(JSON.stringify(keys, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "jwks_unavailable",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
}
