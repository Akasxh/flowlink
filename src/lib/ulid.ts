// Minimal ULID. Not cryptographically perfect, but lexicographically sortable + random.
import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(prefix?: string): string {
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
  return prefix ? `${prefix}_${out}` : out;
}
