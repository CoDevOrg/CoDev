import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@pierre/diffs", "@pierre/theme", "@pierre/theming"],
  serverExternalPackages: ["ioredis", "node-pty", "pg", "ws"],
};

export default withWorkflow(nextConfig);
