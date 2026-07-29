import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["ioredis", "pg", "ws"],
};

export default withWorkflow(nextConfig);
