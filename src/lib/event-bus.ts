// In-memory pub/sub for per-transaction events. Dev-acceptable; Redis pub/sub
// is the planned prod swap (same API surface). Fan-out is O(subscribers) and
// subscribers are per-transaction, so the map stays small in practice.
//
// Replay loads from the TransactionEvent table so late SSE subscribers see
// history. This means: publishers must write to DB FIRST, then call publish().

import { prisma } from "@/lib/prisma";

export type BusEvent = {
  id: string;            // TransactionEvent.id (also SSE event id)
  type: string;          // compliance_passed | mandate_created | settled | receipt_ready | failed
  data: unknown;         // already JSON-parsed
  createdAt: string;     // ISO timestamp, monotonic per transaction
};

type Handler = (event: BusEvent) => void;

const subscribers: Map<string, Set<Handler>> = new Map();

export function subscribe(transactionId: string, handler: Handler): () => void {
  let set = subscribers.get(transactionId);
  if (!set) {
    set = new Set();
    subscribers.set(transactionId, set);
  }
  set.add(handler);
  return () => {
    const cur = subscribers.get(transactionId);
    if (!cur) return;
    cur.delete(handler);
    if (cur.size === 0) subscribers.delete(transactionId);
  };
}

export function publish(transactionId: string, event: BusEvent): void {
  const set = subscribers.get(transactionId);
  if (!set) return;
  // Snapshot so handlers that unsubscribe mid-iteration don't skip peers.
  for (const handler of Array.from(set)) {
    try {
      handler(event);
    } catch (err) {
      // A misbehaving subscriber must not poison fan-out.
      console.error("event-bus handler threw", err);
    }
  }
}

// Load persisted events for a transaction, optionally after `lastEventId`.
// `lastEventId` is a TransactionEvent.id (same as BusEvent.id above).
export async function replay(
  transactionId: string,
  lastEventId?: string,
): Promise<BusEvent[]> {
  const rows = await prisma.transactionEvent.findMany({
    where: { transactionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  let startIdx = 0;
  if (lastEventId) {
    const idx = rows.findIndex((r) => r.id === lastEventId);
    startIdx = idx >= 0 ? idx + 1 : 0; // unknown cursor => full replay
  }
  return rows.slice(startIdx).map((r) => ({
    id: r.id,
    type: r.type,
    data: safeParse(r.data),
    createdAt: r.createdAt.toISOString(),
  }));
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// Test-only helper. Not exported publicly in prod semantics but handy in unit tests.
export function __resetForTests(): void {
  subscribers.clear();
}
