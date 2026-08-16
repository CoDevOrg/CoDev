import { afterEach, describe, expect, it, vi } from "vitest";

import { isHostedCodexSubscriptionEnabled } from "./hosted-codex-subscription-flag";

describe("hosted Codex subscription launch flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stays disabled even when environment variables try to enable it", () => {
    vi.stubEnv("HOSTED_CODEX_SUBSCRIPTION_ENABLED", "true");
    vi.stubEnv("CODEV_ENABLE_HOSTED_CODEX", "true");
    vi.stubEnv("HOSTED_CODEX_APPROVED_CLIENT_ID", "approved-client");
    expect(isHostedCodexSubscriptionEnabled()).toBe(false);
  });
});
