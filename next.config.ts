import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rooms was renamed Sanctum; keep old links working.
  async redirects() {
    return [{ source: "/rooms", destination: "/sanctum", permanent: false }];
  },
};

export default nextConfig;
