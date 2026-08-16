import { describe, expect, it } from "vitest";

import {
  OPENAI_OAUTH_PLAN,
  publicProviderConnectionPayload,
  secretKeysInValue,
  toProviderConnectionRecord,
  toProviderConnectionSnapshot,
} from "./provider-connection-view";

describe("provider connection view", () => {
  it("redacts an encrypted credential row down to connection status", () => {
    const connection = toProviderConnectionRecord({
      provider: "openai",
      label: "OpenAI",
      suppliedBy: "CoDev Test Jordan",
      status: {
        credentialType: "API_KEY",
        lastFour: "9kQ2",
        encryptedApiKey: "kms-v1.ciphertext-should-never-leave",
        encryptedAccessToken: "access-ciphertext",
        apiKey: "sk-live-secret-value",
        apiKeyOrToken: "sk-live-secret-value",
      },
    });

    expect(connection).toEqual({
      provider: "openai",
      label: "OpenAI",
      status: "connected",
      credentialType: "API_KEY",
      lastFour: "9kQ2",
      suppliedBy: "CoDev Test Jordan",
      scope: "personal",
    });
    expect(secretKeysInValue(connection)).toEqual([]);
    expect(JSON.stringify(connection)).not.toMatch(/sk-live|ciphertext/i);
  });

  it("renders OpenAI and Anthropic as not connected when no credential exists", () => {
    const snapshot = toProviderConnectionSnapshot({
      viewer: { id: "user-1", name: "CoDev Test Jordan" },
      statuses: {},
    });

    expect(
      snapshot.connections.map((row) => [row.provider, row.status]),
    ).toEqual([
      ["openai", "not_connected"],
      ["anthropic", "not_connected"],
    ]);
    expect(snapshot.connections.every((row) => row.lastFour === null)).toBe(
      true,
    );
    expect(snapshot.oauth).toEqual(OPENAI_OAUTH_PLAN);
    expect(snapshot.oauth.status).toBe("available");
    expect(snapshot.oauth.summary).toBe("Fixture callback · ready");
    expect(secretKeysInValue(snapshot)).toEqual([]);
  });

  it("keeps API-key and OAuth connection state separate without exposing tokens", () => {
    const snapshot = toProviderConnectionSnapshot({
      viewer: { id: "user-1", name: "CoDev Test Jordan" },
      statuses: {
        openai: {
          credentialType: "API_KEY",
          lastFour: "0001",
          encryptedApiKey: "kms-v1.api-key-ciphertext",
          apiKey: "sk-test-codev-f62-fixture-key0001",
        },
      },
      openAiOAuthStatus: {
        credentialType: "OAUTH_TOKEN",
        lastFour: "fx01",
        encryptedAccessToken: "kms-v1.oauth-ciphertext",
        accessToken: "oa-test-codev-f65-fixture-token-fx01",
      },
    });
    const openai = snapshot.connections.find(
      (row) => row.provider === "openai",
    );
    expect(openai).toMatchObject({
      status: "connected",
      credentialType: "API_KEY",
      lastFour: "0001",
      suppliedBy: "CoDev Test Jordan",
    });
    expect(snapshot.oauth.summary).toBe("Connected · fixture callback");
    expect(JSON.stringify(snapshot)).not.toMatch(
      /oa-test-codev|ciphertext|auth\.openai\.com/i,
    );
  });

  it("rejects a payload that still contains the submitted API key", () => {
    expect(() =>
      publicProviderConnectionPayload(
        { status: "connected", apiKey: "sk-test-codev-f62-fixture-key0001" },
        "sk-test-codev-f62-fixture-key0001",
      ),
    ).toThrow(/must not include secrets|must not echo/i);
  });
});
