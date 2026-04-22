import { NextRequest } from "next/server";
import { z } from "zod";
import { issueNonce } from "@/lib/auth/siwe";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";
import { ADDRESS_REGEX } from "@/lib/chain";

const schema = z.object({
  address: z.string().regex(ADDRESS_REGEX, "address must be 0x + 40 hex chars"),
  chainId: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  const requestId = getOrMintRequestId(req);
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return problemJson({
        code: "validation_error",
        detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        instance: "/v1/auth/siwe/nonce",
        requestId,
      });
    }
    const result = await issueNonce({
      address: parsed.data.address,
      chainId: parsed.data.chainId,
    });
    return new Response(
      JSON.stringify({
        nonce: result.nonce,
        message: result.message,
        expires_in: 300,
        chain_id: result.chainId,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
      },
    );
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}
