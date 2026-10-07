import path from "node:path";
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { securityHeaders } from "./lib/platform/security-headers";

const cloudflareWorkersStub = path.join(
  import.meta.dirname,
  "lib/platform/cloudflare-workers-stub.ts",
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@pierre/diffs", "@pierre/theme", "@pierre/theming"],
  serverExternalPackages: ["ioredis", "node-pty", "pg", "ws"],
  webpack: (config, context) => {
    // vinext probes this hook with a stub compiler and would otherwise alias
    // away the real `cloudflare:workers` module. Webpack also rejects that
    // scheme before a normal alias can rewrite it, so Next builds replace
    // the module directly.
    if (context.webpack.DefinePlugin?.name === "WebpackPluginStub") {
      return config;
    }
    config.resolve.alias["cloudflare:workers"] = cloudflareWorkersStub;
    config.plugins.push(
      new context.webpack.NormalModuleReplacementPlugin(
        /^cloudflare:workers$/,
        cloudflareWorkersStub,
      ),
    );
    config.module.rules.push({
      test: /\.(?:mjs|sh)$/,
      resourceQuery: /raw/,
      type: "asset/source",
    });
    return config;
  },
};

export default withWorkflow(nextConfig);
