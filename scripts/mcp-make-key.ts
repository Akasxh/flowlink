// One-shot helper to mint a test API key for MCP smoke testing.
// Usage: DATABASE_URL="file:./prisma/dev.db" npx tsx scripts/mcp-make-key.ts
import { prisma } from "../src/lib/prisma";
import { generateApiKey } from "../src/lib/auth/apikey";

async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { walletAddress: "0xMcPSmokeUser" },
    update: {},
    create: { walletAddress: "0xMcPSmokeUser", displayName: "mcp-smoke" },
  });
  const k = await generateApiKey({
    userId: user.id,
    name: "mcp-smoke",
    scopes: [
      "invoice:read",
      "invoice:write",
      "pay:execute",
      "receipt:read",
      "compliance:check",
      "reputation:read",
    ],
    env: "test",
  });
  console.log("KEY=" + k.rawKey);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
