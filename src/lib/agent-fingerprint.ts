// Stable agent fingerprint.
//
// Hash of (User-Agent + Accept + Accept-Language). Same agent stack from the
// same machine yields the same 12-char hex prefix. Different builds /
// different LLM SDKs / different runtimes produce different fingerprints.
//
// 12 chars of sha256 = 48 bits of entropy → collision probability is negligible
// at the scale of "how many distinct agent stacks talk to FlowLink in a day".
// We deliberately avoid IP — fingerprints survive NAT and Vercel edge IP churn.

import { createHash } from "node:crypto";

const FP_LEN = 12;
const NULL_HEADER = ""; // missing header → empty string, hashed identically

function pick(req: Request, name: string): string {
  return req.headers.get(name) ?? NULL_HEADER;
}

export function fingerprint(req: Request): string {
  const ua = pick(req, "user-agent");
  const accept = pick(req, "accept");
  const lang = pick(req, "accept-language");
  // Pipe is a delimiter that cannot appear in any single HTTP header value
  // (well — it can — but ambiguity is irrelevant because we hash the whole thing).
  const material = `${ua}|${accept}|${lang}`;
  return createHash("sha256").update(material).digest("hex").slice(0, FP_LEN);
}
