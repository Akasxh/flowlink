// Conference-booth display page. Maximises the demo invoice QR + clear
// "scan this with your agent" instructions, suitable for a 1080p screen
// behind a booth or in a slide deck.

import Link from "next/link";

const DEMO_INVOICE_ID = "inv_DEMO01FLOWLINK000000000";
const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const dynamic = "force-dynamic";

export default function DemoQrPage() {
  const url = `${APP_URL()}/i/${DEMO_INVOICE_ID}`;
  const qrSrc = `/api/qr?text=${encodeURIComponent(url)}&size=720`;

  return (
    <main className="min-h-screen bg-mint-50 px-12 py-16">
      <div className="mx-auto flex max-w-7xl flex-col gap-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-teal-400 to-teal-700"></div>
            <div className="text-2xl font-extrabold tracking-tight text-teal-800">FlowLink</div>
          </div>
          <div className="font-mono text-xs uppercase tracking-widest text-ink-400">
            Booth Demo · Token2049
          </div>
        </header>

        <section className="grid grid-cols-1 items-center gap-12 md:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-8">
            <h1 className="text-7xl font-extrabold leading-[0.95] tracking-tight text-ink-900 md:text-8xl">
              Scan it.<br />
              Your <span className="text-teal-700">agent</span> pays.
            </h1>
            <p className="max-w-2xl text-2xl leading-snug text-ink-500">
              No app to install. Your agent reads the invoice as markdown,
              checks compliance, and pays — entirely from one URL.
            </p>

            <div className="grid max-w-2xl grid-cols-1 gap-3 md:grid-cols-3">
              <Step n="1" title="Scan the QR" body="Resolves to /i/{id}" />
              <Step n="2" title="Agent reads /agent" body="Same URL + /agent → markdown" />
              <Step n="3" title="POST /v1/pay" body="One call. Signed receipt." />
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <Link href={`/i/${DEMO_INVOICE_ID}`} className="rounded-md border border-mint-200 bg-white px-4 py-2 font-mono text-xs text-teal-700 hover:bg-mint-100">→ /i/inv_DEMO01…</Link>
              <Link href={`/i/${DEMO_INVOICE_ID}/agent`} className="rounded-md border border-mint-200 bg-white px-4 py-2 font-mono text-xs text-teal-700 hover:bg-mint-100">→ /i/inv_DEMO01…/agent</Link>
              <Link href="/skills/invoice-link.md" className="rounded-md border border-mint-200 bg-white px-4 py-2 font-mono text-xs text-teal-700 hover:bg-mint-100">→ /skills/invoice-link.md</Link>
              <Link href="/llms.txt" className="rounded-md border border-mint-200 bg-white px-4 py-2 font-mono text-xs text-teal-700 hover:bg-mint-100">→ /llms.txt</Link>
            </div>
          </div>

          <aside className="flex flex-col items-center gap-4">
            <div className="rounded-3xl border border-mint-200 bg-white p-6 shadow-2xl shadow-teal-700/10">
              <img src={qrSrc} alt="Scan to pay" width={460} height={460} className="block" />
            </div>
            <div className="max-w-[280px] text-center">
              <div className="text-sm font-bold uppercase tracking-widest text-teal-700">Live demo invoice</div>
              <div className="mt-1 text-xs font-mono text-ink-400">$1.00 USDC · HashKey · id 133</div>
            </div>
          </aside>
        </section>

        <footer className="mt-8 flex items-center justify-between border-t border-mint-200 pt-6 text-xs text-ink-400">
          <code className="font-mono">github.com/Akasxh/flowlink</code>
          <code className="font-mono">flowlink.ink/llms.txt</code>
        </footer>
      </div>
    </main>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-8 w-8 flex-none place-items-center rounded-full bg-teal-700 font-mono text-sm font-bold text-white">{n}</div>
      <div>
        <div className="text-base font-semibold text-ink-900">{title}</div>
        <div className="mt-0.5 font-mono text-xs text-ink-500">{body}</div>
      </div>
    </div>
  );
}
