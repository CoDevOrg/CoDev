import { describe, expect, it } from "vitest";

import {
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
    expect(secretKeysInValue(snapshot)).toEqual([]);
  });
});
