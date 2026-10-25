import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Node-only CDP server SDK declares optional x402 peers. Keeping it
  // external prevents Turbopack from resolving adapters this app never calls.
  serverExternalPackages: ["@coinbase/cdp-sdk"],
  experimental: {
    agentUpgrade: "security",
  },
  // The AI posting accounts read their persona files at runtime (lib/agentPersonas.ts).
  outputFileTracingIncludes: { "/api/cron/agents": ["./personas/*.md"] },
  // Rooms was renamed Sanctum; keep old links working.
  async redirects() {
    return [{ source: "/rooms", destination: "/sanctum", permanent: false }];
  },
};

export default nextConfig;
