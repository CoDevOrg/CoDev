import { beforeEach, describe, expect, it, vi } from "vitest";

const { persistHostedCodexConnection } = vi.hoisted(() => ({
  // An explicit parameter, even unused, keeps the mock's inferred call-args
  // tuple at length 1 instead of 0, so `mock.calls[n]?.[0]` type-checks.
  persistHostedCodexConnection: vi.fn(
    async (input: Record<string, unknown>) => {
      void input;
    },
  ),
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
    // sharingEnabled is not passed here — persistHostedCodexConnection now
    // defaults it from scopeType itself (see scoped-credential-sharing.ts).
    expect(persistHostedCodexConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        scopeType: "USER",
        scopeId: "user-1",
        accountLabel: "ChatGPT",
        material: expect.objectContaining({
          authCacheJson: expect.stringContaining('"refresh_token":"r"'),
        }),
      }),
    );
    expect(persistHostedCodexConnection.mock.calls[0]?.[0]).not.toHaveProperty(
      "sharingEnabled",
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
      }),
    );
  });
});
