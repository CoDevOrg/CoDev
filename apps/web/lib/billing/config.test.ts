import { describe, expect, it } from "vitest";

import { billingEnvValue, requireBillingEnv } from "./config";

describe("billing environment", () => {
  it("reads Cloudflare billing values from the bundled secret", () => {
    const env = {
      STRIPE_BILLING_SECRETS: JSON.stringify({
        STRIPE_SECRET_KEY: "rk_live_bundle",
        STRIPE_PORTAL_CONFIGURATION_ID: "bpc_bundle",
      }),
    };
    expect(requireBillingEnv("STRIPE_SECRET_KEY", env)).toBe("rk_live_bundle");
    expect(billingEnvValue("STRIPE_PORTAL_CONFIGURATION_ID", env)).toBe(
      "bpc_bundle",
    );
  });

  it("prefers a direct Vercel value over the bundle", () => {
    const env = {
      STRIPE_SECRET_KEY: "rk_live_direct",
      STRIPE_BILLING_SECRETS: JSON.stringify({
        STRIPE_SECRET_KEY: "rk_live_bundle",
      }),
    };
    expect(requireBillingEnv("STRIPE_SECRET_KEY", env)).toBe("rk_live_direct");
  });
});
