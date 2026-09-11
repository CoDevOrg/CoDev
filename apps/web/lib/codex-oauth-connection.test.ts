import { beforeEach, describe, expect, it, vi } from "vitest";

const { persistHostedCodexConnection } = vi.hoisted(() => ({
  persistHostedCodexConnection: vi.fn(async () => {}),
}));
vi.mock("./hosted-codex-subscription-credentials", () => ({
  persistHostedCodexConnection,
}));

import {
  buildCodexAuthCacheJson,
  chatgptAccountIdFromIdToken,
  persistCodexSubscriptionFromOAuth,
} from "./codex-oauth-connection";

/** Craft an unsigned JWT whose payload carries the OpenAI auth claim. */
function idTokenWithAccount(accountId: string) {
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: accountId },
    }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

describe("chatgptAccountIdFromIdToken", () => {
  it("extracts the ChatGPT account id from the id_token claim", () => {
    expect(chatgptAccountIdFromIdToken(idTokenWithAccount("acc-123"))).toBe(
      "acc-123",
    );
  });

  it("returns undefined for a missing or malformed token", () => {
    expect(chatgptAccountIdFromIdToken(undefined)).toBeUndefined();
    expect(chatgptAccountIdFromIdToken("not-a-jwt")).toBeUndefined();
    expect(chatgptAccountIdFromIdToken("a.$$$.c")).toBeUndefined();
  });
});

describe("buildCodexAuthCacheJson", () => {
  it("shapes the OAuth tokens into a Codex auth.json", () => {
    const json = buildCodexAuthCacheJson({
      accessToken: "access",
      refreshToken: "refresh",
      idToken: idTokenWithAccount("acc-9"),
    });
    const parsed = JSON.parse(json);
    expect(parsed).toMatchObject({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        account_id: "acc-9",
      },
    });
    expect(typeof parsed.last_refresh).toBe("string");
  });

  it("refuses to build a cache without a refresh token", () => {
    expect(() => buildCodexAuthCacheJson({ accessToken: "access" })).toThrow(
      /refresh token/i,
    );
  });
});

describe("persistCodexSubscriptionFromOAuth", () => {
  beforeEach(() => {
    persistHostedCodexConnection.mockClear();
  });

  it("persists a personal ChatGPT connection as HOSTED_CODEX_SUBSCRIPTION", async () => {
    await persistCodexSubscriptionFromOAuth({
      userId: "user-1",
      scopeType: "USER",
      scopeId: "user-1",
      tokens: { accessToken: "a", refreshToken: "r" },
    });
    expect(persistHostedCodexConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        scopeType: "USER",
        scopeId: "user-1",
        sharingEnabled: false,
        accountLabel: "ChatGPT",
        material: expect.objectContaining({
          authCacheJson: expect.stringContaining('"refresh_token":"r"'),
        }),
      }),
    );
  });

  it("maps WORKSPACE scope to a shared ORGANIZATION connection", async () => {
    await persistCodexSubscriptionFromOAuth({
      userId: "user-1",
      scopeType: "WORKSPACE",
      scopeId: "workspace-1",
      tokens: { accessToken: "a", refreshToken: "r" },
    });
    expect(persistHostedCodexConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "ORGANIZATION",
        scopeId: "workspace-1",
        sharingEnabled: true,
      }),
    );
  });
});
