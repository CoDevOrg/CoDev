import { afterEach, describe, expect, it, vi } from "vitest";

import { isHostedCodexSubscriptionEnabled } from "./hosted-codex-subscription-flag";

describe("hosted Codex subscription launch flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is enabled by the source flag unless the emergency switch is active", () => {
    vi.stubEnv("HOSTED_CODEX_SUBSCRIPTION_ENABLED", "false");
    vi.stubEnv("CODEV_ENABLE_HOSTED_CODEX", "false");
    expect(isHostedCodexSubscriptionEnabled()).toBe(true);
    vi.stubEnv("HOSTED_CODEX_EMERGENCY_DISABLED", "true");
    expect(isHostedCodexSubscriptionEnabled()).toBe(false);
  });
});
