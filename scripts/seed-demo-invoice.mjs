// Seed a fixed demo invoice so /i/inv_DEMO01 always points to something real.
// Idempotent: safe to re-run. Used by the booth QR demo and as a baseline for
// agent-walkthrough tests.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_INVOICE_ID = "inv_DEMO01FLOWLINK000000000";
const DEMO_USER_EMAIL = "demo@flowlink.ink";
const DEMO_RECEIVER  = "0xFFC1aBE2D34cAFE71b50d72009Ad1a7BeFFEEDDee";  // synthetic, no funds expected

async function main() {
  // Upsert the demo user (FlowLink's own account that owns the demo invoice)
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    create: {
      email: DEMO_USER_EMAIL,
      displayName: "FlowLink Demo Wallet",
    },
    update: {},
  });

  const dueAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year (so it never expires for demo)

  const invoice = await prisma.invoice.upsert({
    where: { id: DEMO_INVOICE_ID },
    create: {
      id: DEMO_INVOICE_ID,
      flowlinkId: `flowlink:inv/${DEMO_INVOICE_ID}`,
      issuerId: user.id,
      receiverAddress: DEMO_RECEIVER,
      amount: "1.00",
      token: "USDC",
      chainId: 133,
      purpose: "FlowLink booth demo · scan, agent reads, agent pays",
      status: "pending",
      dueAt,
    },
    update: {
      // refresh dueAt + purpose if re-seeded
      dueAt,
      purpose: "FlowLink booth demo · scan, agent reads, agent pays",
      status: "pending",
    },
  });

  console.log(`✓ demo invoice seeded`);
  console.log(`  id:        ${invoice.id}`);
  console.log(`  amount:    ${invoice.amount} ${invoice.token}`);
  console.log(`  receiver:  ${invoice.receiverAddress}`);
  console.log(`  due:       ${invoice.dueAt.toISOString()}`);
  console.log(`  status:    ${invoice.status}`);
  console.log("");
  console.log(`Visit:     http://localhost:3000/i/${invoice.id}`);
  console.log(`Agent:     http://localhost:3000/i/${invoice.id}/agent`);
  console.log(`Booth QR:  http://localhost:3000/demo/qr`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
