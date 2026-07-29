import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["ioredis", "pg", "ws"],
};

export default nextConfig;
