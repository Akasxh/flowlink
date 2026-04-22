import Link from "next/link";

const SKILLS = [
  { name: "invoice", summary: "Create, read, cancel invoices" },
  { name: "pay", summary: "Settle invoices via HSP Single-Pay mandate" },
  { name: "compliance", summary: "OFAC + velocity screening" },
  { name: "receipt", summary: "Ed25519-signed receipts" },
  { name: "reputation", summary: "Counterparty reputation score" },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="mb-12">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-mint-200 bg-mint-100 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-teal-700">
          Agent-Native · HashKey Chain
        </div>
        <h1 className="mb-4 text-5xl font-extrabold leading-tight text-teal-800">
          Markdown is the API.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-ink-500">
          FlowLink is a compliance-first payment layer for the agent economy. Every capability is a markdown
          file any agent can read, reason over, and call against — no SDK, no keys for read, wallet-signature
          for write. Built on HashKey Chain (id 133).
        </p>
      </header>

      <section className="mb-12 grid grid-cols-1 gap-4 md:grid-cols-3">
        <DiscoveryCard href="/llms.txt" label="Start here (agents)" sub="/llms.txt" />
        <DiscoveryCard href="/.well-known/flowlink.md" label="Agent quickstart" sub="/.well-known/flowlink.md" />
        <DiscoveryCard href="/.well-known/mcp.json" label="MCP manifest" sub="/.well-known/mcp.json" />
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-teal-700">Skills</h2>
        <ul className="divide-y divide-mint-200 rounded-xl border border-mint-200 bg-white">
          {SKILLS.map((s) => (
            <li key={s.name} className="flex items-center justify-between px-5 py-4">
              <div>
                <Link
                  href={`/skills/${s.name}.md`}
                  className="font-mono text-sm font-semibold text-teal-700 hover:underline"
                >
                  /skills/{s.name}.md
                </Link>
                <p className="mt-1 text-sm text-ink-500">{s.summary}</p>
              </div>
              <code className="font-mono text-xs text-ink-400">GET</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-12 rounded-xl border border-mint-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-teal-700">
          Compliance is not optional
        </h2>
        <p className="mb-4 text-sm text-ink-500">
          Every <code className="rounded bg-mint-100 px-1.5 py-0.5 font-mono text-xs text-teal-700">pay</code>{" "}
          call runs OFAC screening and velocity checks inline. Sanctioned counterparties fail the call before
          funds move. Every settlement emits an ed25519-signed receipt you (or an auditor) can verify against
          our published public key.
        </p>
        <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
          <li className="rounded-lg bg-mint-50 px-3 py-2 text-teal-700">OFAC · fail closed on upstream error</li>
          <li className="rounded-lg bg-mint-50 px-3 py-2 text-teal-700">HSP Single-Pay mandates</li>
          <li className="rounded-lg bg-mint-50 px-3 py-2 text-teal-700">Ed25519 verifiable receipts</li>
        </ul>
      </section>

      <footer className="border-t border-mint-200 pt-6 text-xs text-ink-400">
        <p>
          Source:{" "}
          <a className="underline" href="https://github.com/Akasxh/flowlink">
            github.com/Akasxh/flowlink
          </a>
          {" · "}
          License MIT · Built on HashKey Chain testnet (id 133)
        </p>
      </footer>
    </main>
  );
}

function DiscoveryCard({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-mint-200 bg-white p-5 transition hover:border-teal-400 hover:shadow"
    >
      <div className="text-xs font-semibold uppercase tracking-widest text-ink-400">{label}</div>
      <div className="mt-2 font-mono text-sm text-teal-700">{sub}</div>
    </Link>
  );
}
