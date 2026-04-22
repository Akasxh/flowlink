/** @type {import('next').NextConfig} */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api-testnet.hsp.hashkey.com https://hashkeychain-testnet.alt.technology",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const corsHeaders = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Authorization, Content-Type, Idempotency-Key, X-Request-Id" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/v1/:path*", headers: corsHeaders },
      { source: "/.well-known/:path*", headers: [...corsHeaders, { key: "Cache-Control", value: "public, max-age=300" }] },
      { source: "/llms.txt", headers: [...corsHeaders, { key: "Cache-Control", value: "public, max-age=300" }] },
      { source: "/skills/:path*", headers: [...corsHeaders, { key: "Cache-Control", value: "public, max-age=300" }] },
    ];
  },
};

export default nextConfig;
