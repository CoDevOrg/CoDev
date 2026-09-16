import { afterEach, describe, expect, it, vi } from "vitest";

import { encryptSecret } from "./kms";

afterEach(() => {
  delete process.env.CREDENTIAL_KEY_VAULT_KEY_ID;
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  vi.clearAllMocks();
});

describe("local development fallback", () => {
  /**
   * The development fallback used to sit inside the AWS branch of a
   * provider-dispatched encryptSecret. When the default cloud moved to Azure,
   * an unconfigured local checkout — no Key Vault key, no KMS key — began
   * throwing on the first credential it stored, because the Azure path
   * demanded a managed key where AWS had not. The AWS branch is gone now, but
   * the fallback it once hid behind still has to work for a developer, and
   * still must not fire in production.
   */
  it("writes a development envelope with no Key Vault key configured", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString(
      "base64",
    );

    const encrypted = await encryptSecret("github-access-token");

    expect(encrypted.startsWith("v1.")).toBe(true);
    // Neither managed format: not the Key Vault one, and not the retired AWS
    // one, whose decrypt path no longer exists to read it back.
    expect(encrypted.startsWith("akv-v1.")).toBe(false);
    expect(encrypted.startsWith("kms-v1.")).toBe(false);
  });
});
