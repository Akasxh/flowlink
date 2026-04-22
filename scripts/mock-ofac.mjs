// Tiny OFAC mock for local dev/demo. api.ofac.dev isn't always reachable from
// the dev environment, and FlowLink fails closed on OFAC upstream errors (by
// design). This mock simulates a clean response so full happy-path demos work.
// The embedded fallback sanctions list in lib/compliance.ts still catches the
// real Tornado Cash addresses before hitting this mock.

import http from "node:http";

const PORT = Number(process.env.MOCK_OFAC_PORT ?? 8089);

const server = http.createServer((req, res) => {
  const address = (req.url ?? "").split("/").pop() ?? "";
  const body = {
    address,
    sanctioned: false,
    list: [],
    source: "mock-ofac-dev",
    checked_at: new Date().toISOString(),
  };
  res.writeHead(200, {
    "Content-Type": "application/json",
    "X-Mock-OFAC": "true",
  });
  res.end(JSON.stringify(body));
});

server.listen(PORT, () => {
  console.log(`[mock-ofac] listening on http://localhost:${PORT}`);
  console.log(`[mock-ofac] set OFAC_API_URL="http://localhost:${PORT}/v1/ethereum" in .env.local`);
});
