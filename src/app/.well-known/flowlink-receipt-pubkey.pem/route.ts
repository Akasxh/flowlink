import { publicKeyPem } from "@/lib/receipts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pem = await publicKeyPem();
    return new Response(pem, {
      status: 200,
      headers: {
        "Content-Type": "application/x-pem-file",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    return new Response(
      `# Receipt public key unavailable: ${err instanceof Error ? err.message : String(err)}\n`,
      { status: 503, headers: { "Content-Type": "text/plain" } },
    );
  }
}
