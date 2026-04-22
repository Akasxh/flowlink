import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://flowlink.ink"),
  title: "FlowLink — Agent-Native Payments",
  description:
    "Compliance-first payment layer for the agent economy. Markdown is the API. No SDK. HashKey Chain settlement.",
  alternates: {
    types: {
      "text/markdown": "/.well-known/flowlink.md",
      "application/json": "/.well-known/mcp.json",
      "application/yaml": "/.well-known/openapi.yaml",
    },
  },
  openGraph: {
    title: "FlowLink — Agent-Native Payments",
    description: "Markdown is the API. Agents discover and transact without SDKs.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="alternate" type="text/markdown" href="/.well-known/flowlink.md" title="Agent guide" />
        <link rel="alternate" type="application/json" href="/.well-known/mcp.json" title="MCP manifest" />
        <link rel="describedby" href="/llms.txt" />
      </head>
      <body className="bg-mint-50 text-ink-700 font-sans antialiased">{children}</body>
    </html>
  );
}
