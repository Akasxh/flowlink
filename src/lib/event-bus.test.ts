import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock prisma BEFORE importing the bus so the singleton imports the mocked module.
vi.mock("@/lib/prisma", () => {
  const findMany = vi.fn();
  return {
    prisma: { transactionEvent: { findMany } },
  };
});

import { prisma } from "@/lib/prisma";
import {
  publish,
  subscribe,
  replay,
  __resetForTests,
  type BusEvent,
} from "./event-bus";

const findMany = prisma.transactionEvent.findMany as unknown as ReturnType<typeof vi.fn>;

function ev(id: string, type: string, data: unknown = {}): BusEvent {
  return { id, type, data, createdAt: new Date(0).toISOString() };
}

beforeEach(() => {
  __resetForTests();
  findMany.mockReset();
});

describe("event-bus pub/sub", () => {
  it("delivers a published event to a single subscriber", () => {
    const got: BusEvent[] = [];
    const unsub = subscribe("txn_1", (e) => got.push(e));
    publish("txn_1", ev("e1", "settled"));
    expect(got).toHaveLength(1);
    expect(got[0]?.type).toBe("settled");
    unsub();
  });

  it("fans out to multiple subscribers", () => {
    const a: BusEvent[] = [];
    const b: BusEvent[] = [];
    subscribe("txn_2", (e) => a.push(e));
    subscribe("txn_2", (e) => b.push(e));
    publish("txn_2", ev("e1", "compliance_passed"));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("unsubscribe removes the handler", () => {
    const got: BusEvent[] = [];
    const unsub = subscribe("txn_3", (e) => got.push(e));
    unsub();
    publish("txn_3", ev("e1", "failed"));
    expect(got).toHaveLength(0);
  });

  it("isolates subscribers by transactionId", () => {
    const a: BusEvent[] = [];
    subscribe("txn_a", (e) => a.push(e));
    publish("txn_b", ev("e1", "settled"));
    expect(a).toHaveLength(0);
  });

  it("a handler that throws does not block peers", () => {
    const peer: BusEvent[] = [];
    subscribe("txn_4", () => {
      throw new Error("boom");
    });
    subscribe("txn_4", (e) => peer.push(e));
    publish("txn_4", ev("e1", "mandate_created"));
    expect(peer).toHaveLength(1);
  });

  it("handler unsubscribing during iteration does not skip peers", () => {
    const seen: string[] = [];
    let unsubB = (): void => undefined;
    subscribe("txn_5", () => {
      seen.push("a");
      unsubB();
    });
    unsubB = subscribe("txn_5", () => {
      seen.push("b");
    });
    publish("txn_5", ev("e1", "settled"));
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("event-bus replay", () => {
  it("returns all DB events when no cursor is given", async () => {
    findMany.mockResolvedValueOnce([
      { id: "ev_1", type: "compliance_passed", data: '{"score":99}', createdAt: new Date(1) },
      { id: "ev_2", type: "settled", data: '{"tx_hash":"0xabc"}', createdAt: new Date(2) },
    ]);
    const out = await replay("txn_x");
    expect(out).toHaveLength(2);
    expect(out[0]?.id).toBe("ev_1");
    expect(out[1]?.data).toEqual({ tx_hash: "0xabc" });
  });

  it("resumes after lastEventId", async () => {
    findMany.mockResolvedValueOnce([
      { id: "ev_1", type: "a", data: "{}", createdAt: new Date(1) },
      { id: "ev_2", type: "b", data: "{}", createdAt: new Date(2) },
      { id: "ev_3", type: "c", data: "{}", createdAt: new Date(3) },
    ]);
    const out = await replay("txn_y", "ev_1");
    expect(out.map((e) => e.id)).toEqual(["ev_2", "ev_3"]);
  });

  it("falls back to full replay when lastEventId is unknown", async () => {
    findMany.mockResolvedValueOnce([
      { id: "ev_1", type: "a", data: "{}", createdAt: new Date(1) },
    ]);
    const out = await replay("txn_z", "ev_does_not_exist");
    expect(out).toHaveLength(1);
  });

  it("tolerates non-JSON data field", async () => {
    findMany.mockResolvedValueOnce([
      { id: "ev_1", type: "a", data: "not-json", createdAt: new Date(1) },
    ]);
    const out = await replay("txn_q");
    expect(out[0]?.data).toBe("not-json");
  });
});
