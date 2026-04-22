import { NextRequest } from "next/server";
import { problemJson, problemFromUnknown } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";
import { ADDRESS_REGEX } from "@/lib/chain";
import { prisma } from "@/lib/prisma";

type RouteCtx = { params: { address: string } };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const requestId = getOrMintRequestId(req);
  try {
    const address = ctx.params.address;
    if (!ADDRESS_REGEX.test(address)) {
      return problemJson({ code: "validation_error", detail: "not an EIP-55 address", requestId });
    }

    const addrLower = address.toLowerCase();
    const asPayer = await prisma.transaction.findMany({
      where: { payerAddress: addrLower, status: "settled" },
      select: { amount: true, token: true, createdAt: true },
    });
    const asPayee = await prisma.transaction.findMany({
      where: { receiverAddress: addrLower, status: "settled" },
      select: { amount: true, token: true, createdAt: true },
    });

    const totalTxs = asPayer.length + asPayee.length;
    if (totalTxs === 0) {
      return problemJson({
        code: "not_found",
        detail: "no FlowLink activity for this address",
        requestId,
      });
    }

    // Volume is a rough sum in USD — for v1 we treat USDC/USDT 1:1, ignore HSK price.
    const sumUsd = (rows: Array<{ amount: string; token: string }>) =>
      rows
        .filter((r) => r.token === "USDC" || r.token === "USDT")
        .reduce((a, r) => a + Number(r.amount), 0);
    const payerVolume = sumUsd(asPayer);
    const payeeVolume = sumUsd(asPayee);
    const volumeUsd = payerVolume + payeeVolume;

    // Score: log-saturating tx_count (25%) + log-saturating volume (25%) + placeholder on-time (25%) + no disputes (25%)
    const logSat = (x: number, cap: number) => Math.min(1, Math.log1p(x) / Math.log1p(cap));
    const score = Math.round(
      (logSat(totalTxs, 200) * 0.25 +
        logSat(volumeUsd, 100000) * 0.25 +
        1 * 0.25 + // on_time placeholder — derived from txns without failures
        1 * 0.25) *
        100,
    );

    const firstSeen = [...asPayer, ...asPayee]
      .map((r) => r.createdAt)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const lastSeen = [...asPayer, ...asPayee]
      .map((r) => r.createdAt)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return new Response(
      JSON.stringify({
        address,
        score,
        tx_count: totalTxs,
        volume_usd: volumeUsd,
        on_time_rate: 1.0,
        disputes: 0,
        first_seen: firstSeen?.toISOString(),
        last_seen: lastSeen?.toISOString(),
        as_payer: { count: asPayer.length, volume_usd: payerVolume },
        as_payee: { count: asPayee.length, volume_usd: payeeVolume },
        compliance_flags: [],
      }),
      { status: 200, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } },
    );
  } catch (err) {
    return problemFromUnknown(err, requestId);
  }
}
