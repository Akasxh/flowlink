import { PrismaClient } from "@prisma/client";

// Singleton pattern — Next.js dev hot-reload safety.
declare global {
  // eslint-disable-next-line no-var
  var __flowlinkPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__flowlinkPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__flowlinkPrisma = prisma;
}
