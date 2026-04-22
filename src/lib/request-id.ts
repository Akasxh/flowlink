// Tiny helper to mint or echo X-Request-Id. ULID-ish (timestamp + random).
import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function ulid(): string {
  const ts = Date.now();
  let out = "";
  let t = ts;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32]! + out;
    t = Math.floor(t / 32);
  }
  const rand = randomBytes(10);
  for (let i = 0; i < 16; i++) {
    const idx = rand[i % 10]! % 32;
    out += CROCKFORD[idx]!;
  }
  return out;
}

export function getOrMintRequestId(req: Request): string {
  const incoming = req.headers.get("x-request-id");
  if (incoming && incoming.length <= 128) return incoming;
  return `req_${ulid()}`;
}
