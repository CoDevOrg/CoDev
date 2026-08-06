import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep Cursor SDK out of the webpack graph — its package ships .d.ts.map
  // sidecars that webpack otherwise tries to parse as modules.
  serverExternalPackages: ["@cursor/sdk", "ioredis", "pg", "ws"],
};

export default withWorkflow(nextConfig);
