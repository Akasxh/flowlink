// SSE stream for a transaction's lifecycle events.
//
// Wire format (per event):
//   id: <event-id>\n
//   event: <type>\n
//   data: <json>\n\n
//
// On connect: replay all DB events (so late subscribers get full history). If
// the client sent `Last-Event-ID`, only events after that id are replayed.
// Then we subscribe to the in-process event bus for live fan-out.
//
// Heartbeat: ":\n\n" comment line every 15s — keeps proxies and browsers from
// killing the idle stream. Per the SSE spec, lines starting with ":" are ignored
// by EventSource clients but still travel through the TCP connection.

import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { problemJson } from "@/lib/errors";
import { getOrMintRequestId } from "@/lib/request-id";
import { prisma } from "@/lib/prisma";
import { replay, subscribe, type BusEvent } from "@/lib/event-bus";

type RouteCtx = { params: { id: string } };

const HEARTBEAT_MS = 15_000;

export const dynamic = "force-dynamic"; // never cache an SSE stream

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const requestId = getOrMintRequestId(req);

  const principal = await authenticate(req);
  if (!principal) return problemJson({ code: "auth_required", requestId });

  const txn = await prisma.transaction.findUnique({
    where: { id: ctx.params.id },
    select: { id: true },
  });
  if (!txn) return problemJson({ code: "transaction_not_found", requestId });

  const lastEventId = req.headers.get("last-event-id") ?? undefined;
  const transactionId = txn.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // Track delivered ids so live events that race the replay query don't
      // produce duplicates on the wire.
      const seen = new Set<string>();
      const writeEvent = (e: BusEvent): void => {
        if (seen.has(e.id)) return;
        seen.add(e.id);
        safeEnqueue(formatEvent(e));
      };

      // Buffer live events that arrive while we're still streaming the replay.
      // Without this, a late-arriving "settled" could land before its older
      // siblings and break the implicit ordering contract.
      let replayDone = false;
      const buffered: BusEvent[] = [];
      const unsubscribe = subscribe(transactionId, (e) => {
        if (!replayDone) {
          buffered.push(e);
          return;
        }
        writeEvent(e);
      });

      // Initial preamble: comment + a synthetic open event so EventSource fires `onopen`.
      safeEnqueue(`: connected request_id=${requestId}\n\n`);

      try {
        const history = await replay(transactionId, lastEventId);
        for (const e of history) writeEvent(e);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        safeEnqueue(`event: error\ndata: ${JSON.stringify({ message: detail })}\n\n`);
      }

      replayDone = true;
      while (buffered.length > 0) {
        const next = buffered.shift();
        if (next) writeEvent(next);
      }

      const heartbeat = setInterval(() => {
        safeEnqueue(`: ping\n\n`);
      }, HEARTBEAT_MS);

      const onAbort = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", onAbort, { once: true });

      // Stash teardown so cancel() can find it without recreating closures.
      (controller as unknown as { __flowlinkTeardown?: () => void }).__flowlinkTeardown = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };
    },
    cancel(_reason) {
      // Client-disconnect path. Pull the teardown stashed in start().
      const teardown = (this as unknown as { __flowlinkTeardown?: () => void }).__flowlinkTeardown;
      if (teardown) teardown();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering when fronted
      "X-Request-Id": requestId,
    },
  });
}

function formatEvent(e: BusEvent): string {
  // SSE payload must not contain bare newlines in `data:` lines; JSON.stringify
  // never produces raw newlines, so a single data: line is safe.
  const payload = JSON.stringify({ ...(typeof e.data === "object" && e.data !== null ? e.data : { value: e.data }), at: e.createdAt });
  return `id: ${e.id}\nevent: ${e.type}\ndata: ${payload}\n\n`;
}
