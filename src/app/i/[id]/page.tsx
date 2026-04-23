// Public, agent-friendly invoice page. Renders a human-friendly view with a
// prominent QR + the agent-callable JSON / markdown shape inline. No auth to
// READ; paying still requires SIWE/JWT per /skills/pay.md.

import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";

type Props = { params: { id: string } };

export const dynamic = "force-dynamic";

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default async function InvoicePage({ params }: Props) {
  const invoice = await prisma.invoice.findUnique({ where: { id: params.id } });
  if (!invoice) notFound();

  const inv = invoice;
  const url = `${APP_URL()}/i/${inv.id}`;
  const agentUrl = `${url}/agent`;
  const qrSrc = `/api/qr?text=${encodeURIComponent(url)}&size=560`;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/" className="font-mono text-xs uppercase tracking-widest text-teal-700">← flowlink</Link>
        <code className="font-mono text-xs text-ink-400">{inv.flowlinkId}</code>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[1fr_auto]">
        {/* left: invoice card */}
        <section className="rounded-2xl border border-mint-200 bg-white p-8">
          <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-mint-200 bg-mint-100 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-teal-700">
            Invoice · {inv.status}
          </div>
          <div className="my-6 flex items-baseline gap-3">
            <div className="font-sans text-6xl font-extrabold leading-none text-teal-800">{inv.amount}</div>
            <div className="font-sans text-2xl font-bold text-ink-400">{inv.token}</div>
          </div>
          <p className="mb-6 max-w-md text-ink-500">
            {inv.purpose ?? "FlowLink invoice"}
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-ink-400">Receiver</dt>
            <dd className="font-mono text-xs text-ink-700 break-all">{inv.receiverAddress}</dd>
            <dt className="text-ink-400">Chain</dt>
            <dd className="font-mono text-xs text-ink-700">HashKey · id {inv.chainId}</dd>
            <dt className="text-ink-400">Due</dt>
            <dd className="font-mono text-xs text-ink-700">{inv.dueAt.toISOString().slice(0, 10)}</dd>
            <dt className="text-ink-400">Created</dt>
            <dd className="font-mono text-xs text-ink-700">{inv.createdAt.toISOString().slice(0, 10)}</dd>
          </dl>

          <div className="mt-8 rounded-xl border border-mint-200 bg-mint-50 p-5">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-teal-700">For agents</div>
            <div className="mb-3 text-sm text-ink-500">
              Same data, machine-readable. Curl or wget directly:
            </div>
            <code className="block font-mono text-xs leading-relaxed text-teal-800 break-all">
              curl {agentUrl}
            </code>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/i/${inv.id}/agent`} className="rounded-md border border-mint-200 bg-white px-3 py-2 font-mono text-xs text-teal-700 hover:bg-mint-100">→ /i/{inv.id.slice(0, 12)}…/agent</Link>
              <Link href="/skills/pay.md" className="rounded-md border border-mint-200 bg-white px-3 py-2 font-mono text-xs text-teal-700 hover:bg-mint-100">→ /skills/pay.md</Link>
              <Link href="/llms.txt" className="rounded-md border border-mint-200 bg-white px-3 py-2 font-mono text-xs text-teal-700 hover:bg-mint-100">→ /llms.txt</Link>
            </div>
          </div>
        </section>

        {/* right: QR */}
        <aside className="flex flex-col items-center gap-3">
          <div className="rounded-2xl border border-mint-200 bg-white p-4">
            <img src={qrSrc} alt="Scan to pay" width={280} height={280} className="block" />
          </div>
          <div className="text-center">
            <div className="text-xs font-bold uppercase tracking-widest text-teal-700">Scan with any agent</div>
            <div className="mt-1 max-w-[220px] text-xs text-ink-400">Resolves to this page; agents fetch <code className="font-mono">/agent</code> for the markdown spec.</div>
          </div>
        </aside>
      </div>
    </main>
  );
}
