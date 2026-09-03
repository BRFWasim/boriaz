import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [],
  agentRules: false, // redeploy-marker-v4
};

export default nextConfig;
