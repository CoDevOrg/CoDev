import { describe, expect, it } from "vitest";

import { assertHostedCodexAuditPayloadIsRedacted } from "./hosted-codex-subscription-audit";
import { provisionPayloadContainsProviderCredential } from "./hosted-codex-runtime-delivery";

describe("hosted Codex audit and runtime delivery redaction", () => {
  it("rejects audit payloads that include token material", () => {
    expect(() =>
      assertHostedCodexAuditPayloadIsRedacted({
        access_token: "secret",
      }),
    ).toThrow(/must not include secrets/);
    expect(() =>
      assertHostedCodexAuditPayloadIsRedacted({
        credentialId: "cred-1",
        result: "success",
      }),
    ).not.toThrow();
  });

  it("detects long-lived credentials in a sandbox provision payload", () => {
    expect(
      provisionPayloadContainsProviderCredential({
        workspaceId: "workspace-1",
        repositoryUrl: "https://github.com/acme/app.git",
      }),
    ).toBe(false);
    expect(
      provisionPayloadContainsProviderCredential({
        environment: { OPENAI_API_KEY: "sk-live" },
      }),
    ).toBe(true);
  });
});
