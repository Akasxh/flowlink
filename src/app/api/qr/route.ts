import { NextRequest } from "next/server";
import QRCode from "qrcode";

// GET /api/qr?text=<url-encoded>&size=400
// Returns an SVG QR code. Cached aggressively — same input, same output.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const text = url.searchParams.get("text");
  const size = Math.min(Math.max(Number(url.searchParams.get("size") ?? "400"), 64), 1200);

  if (!text || text.length > 2048) {
    return new Response(JSON.stringify({ error: "text param required, max 2048 chars" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const svg = await QRCode.toString(text, {
    type: "svg",
    width: size,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0c6363", light: "#ffffff" },
  });

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
