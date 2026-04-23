#!/usr/bin/env node
// CI driver for the FlowLink sitemap crawler test.
//
// Two modes:
//
//   - `--external` (default if FLOWLINK_URL is set, or `--url=...` is passed):
//     assume a server is already running at the given URL. Just wait for
//     /llms.txt to return 200, then invoke tests/sitemap-crawler.sh. Useful
//     when the test runs against a deployed preview or a dev server already
//     started by the developer.
//
//   - `--managed` (default otherwise): boot `pnpm dev` as a child process,
//     wait for /llms.txt readiness, run the crawler, and tear the dev server
//     down on exit. Useful for one-shot CI invocations.
//
// Exit code is the crawler's exit code. Anything non-zero fails CI.
//
// No npm deps. Pure node:* + the existing pnpm/bash setup.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const crawlerPath = resolve(repoRoot, "tests/sitemap-crawler.sh");

if (!existsSync(crawlerPath)) {
  console.error(`crawler script missing: ${crawlerPath}`);
  process.exit(2);
}

// ─────────────────────────────────────────────────────────────────────
// arg parsing

const argv = process.argv.slice(2);
let baseUrl = process.env.FLOWLINK_URL ?? null;
let mode = baseUrl ? "external" : null;

for (const a of argv) {
  if (a === "--external") mode = "external";
  else if (a === "--managed") mode = "managed";
  else if (a.startsWith("--url=")) {
    baseUrl = a.slice("--url=".length);
    if (!mode) mode = "external";
  } else if (a === "-h" || a === "--help") {
    console.log(`usage: node scripts/run-sitemap-test.mjs [--managed | --external] [--url=URL]
  --managed     boot \`pnpm dev\` and run the crawler against it (default)
  --external    assume a server is already running (default if --url or FLOWLINK_URL is set)
  --url=URL     base URL to test against (defaults to http://localhost:3000)
  env FLOWLINK_URL  same as --url`);
    process.exit(0);
  }
}

if (!mode) mode = "managed";
if (!baseUrl) baseUrl = "http://localhost:3000";

// ─────────────────────────────────────────────────────────────────────
// readiness probe

async function waitForLlmsTxt(url, { timeoutMs = 60_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/llms.txt`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (res.status === 200) return true;
      lastErr = new Error(`status=${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `timed out waiting for ${url}/llms.txt (last error: ${lastErr?.message ?? "unknown"})`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// dev server lifecycle (managed mode only)

let devServer = null;

function startDevServer() {
  console.log("[run-sitemap-test] booting `pnpm dev` in", repoRoot);
  // Run via pnpm so the same script lockfile / scripts metadata is used as in
  // local development. inherit stdio so build errors are visible.
  devServer = spawn("pnpm", ["dev"], {
    cwd: repoRoot,
    stdio: ["ignore", "inherit", "inherit"],
    detached: false,
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "development" },
  });

  devServer.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[run-sitemap-test] dev server exited code=${code} signal=${signal}`);
    }
  });
}

function stopDevServer() {
  if (!devServer || devServer.killed) return;
  console.log("[run-sitemap-test] stopping dev server (pid=" + devServer.pid + ")");
  try {
    // pnpm dev spawns next dev as a child. SIGTERM first; SIGKILL after 3s if
    // it didn't exit. Send to the whole process group so children die too.
    if (typeof devServer.pid === "number") {
      try { process.kill(-devServer.pid, "SIGTERM"); }
      catch { devServer.kill("SIGTERM"); }
    }
  } catch (err) {
    console.warn("[run-sitemap-test] SIGTERM failed:", err?.message);
  }
  setTimeout(() => {
    if (devServer && !devServer.killed) {
      try { devServer.kill("SIGKILL"); } catch {}
    }
  }, 3_000).unref();
}

process.on("SIGINT", () => { stopDevServer(); process.exit(130); });
process.on("SIGTERM", () => { stopDevServer(); process.exit(143); });

// ─────────────────────────────────────────────────────────────────────
// crawler

function runCrawler(url) {
  return new Promise((res) => {
    const child = spawn("bash", [crawlerPath, url], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    child.on("exit", (code) => res(code ?? 1));
    child.on("error", (err) => {
      console.error("[run-sitemap-test] crawler spawn error:", err?.message);
      res(1);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// main

let exitCode = 1;
try {
  if (mode === "managed") {
    startDevServer();
    console.log(`[run-sitemap-test] waiting for ${baseUrl}/llms.txt (managed mode)...`);
    await waitForLlmsTxt(baseUrl, { timeoutMs: 120_000 });
    console.log("[run-sitemap-test] dev server ready");
  } else {
    console.log(`[run-sitemap-test] external mode, target=${baseUrl}`);
    console.log(`[run-sitemap-test] checking ${baseUrl}/llms.txt...`);
    await waitForLlmsTxt(baseUrl, { timeoutMs: 10_000, intervalMs: 500 });
    console.log("[run-sitemap-test] external server is up");
  }

  exitCode = await runCrawler(baseUrl);
  console.log(`[run-sitemap-test] crawler exit code: ${exitCode}`);
} catch (err) {
  console.error("[run-sitemap-test] error:", err?.message ?? err);
  if (mode === "external") {
    console.error("[run-sitemap-test] hint: start a dev server with `pnpm dev` or pass --managed");
  }
  exitCode = 2;
} finally {
  stopDevServer();
}

process.exit(exitCode);
