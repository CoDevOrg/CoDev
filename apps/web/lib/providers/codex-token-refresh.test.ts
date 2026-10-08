import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  seat: vi.fn(),
  save: vi.fn(),
}));
vi.mock("./credential-seat", () => ({ credentialSeatHolder: mocks.seat }));
vi.mock("./hosted-codex-subscription-credentials", () => ({
  updateHostedCodexAuthCacheIfCurrent: mocks.save,
}));

import {
  CodexReconnectRequiredError,
  freshCodexSecret,
} from "./codex-token-refresh";

const jwt = (claims: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const idToken = jwt({
  "https://api.openai.com/auth": { chatgpt_account_id: "account-1" },
});
const credential = (expSeconds: number) => ({
  credentialId: "credential-1",
  credentialRevision: "2026-10-08T07:00:00.000Z",
  secret: {
    kind: "codex_auth_cache" as const,
    authCacheJson: JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: jwt({ exp: expSeconds }),
        refresh_token: "refresh-old",
        id_token: idToken,
        account_id: "account-1",
      },
    }),
  },
});
const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.seat.mockResolvedValue(null);
  mocks.save.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllGlobals());

it("leaves a valid access token alone without contacting OpenAI", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const input = credential(now() + 3600);
  expect(await freshCodexSecret(input)).toBe(input.secret);
  expect(fetch).not.toHaveBeenCalled();
});

it("refreshes an expired token like the Codex CLI and saves the rotated tokens", async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      access_token: jwt({ exp: now() + 3600 }),
      refresh_token: "refresh-new",
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const secret = await freshCodexSecret(credential(now() - 60));

  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://auth.openai.com/oauth/token");
  expect(JSON.parse(String(init.body))).toEqual({
    client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
    grant_type: "refresh_token",
    refresh_token: "refresh-old",
    scope: "openid profile email",
  });
  const saved = JSON.parse(mocks.save.mock.calls[0]![2]);
  expect(mocks.save).toHaveBeenCalledWith(
    "credential-1",
    "2026-10-08T07:00:00.000Z",
    expect.any(String),
  );
  expect(saved.auth_mode).toBe("chatgpt");
  expect(saved.tokens.refresh_token).toBe("refresh-new");
  // OpenAI may omit the id token on refresh; the account id must survive.
  expect(saved.tokens.account_id).toBe("account-1");
  expect(secret).toEqual({
    kind: "codex_auth_cache",
    authCacheJson: mocks.save.mock.calls[0]![2],
  });
});

it("never races a running turn's CLI for the same rotating refresh token", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.seat.mockResolvedValue({ surface: "gen2", ref: "session-1" });
  const input = credential(now() - 60);
  expect(await freshCodexSecret(input)).toBe(input.secret);
  expect(fetch).not.toHaveBeenCalled();
});

it("asks for a reconnect when OpenAI rejects the refresh token, without leaking it", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: "refresh_token_reused" }, { status: 401 }),
    ),
  );
  const error = await freshCodexSecret(credential(now() - 60)).catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CodexReconnectRequiredError);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("refresh-old");
  expect(mocks.save).not.toHaveBeenCalled();
  warn.mockRestore();
});

it("refuses to overwrite a credential that changed during the refresh", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ access_token: jwt({ exp: now() + 3600 }) }),
    ),
  );
  mocks.save.mockResolvedValue(false);
  await expect(freshCodexSecret(credential(now() - 60))).rejects.toThrow(
    "Codex connection changed",
  );
});

it("passes API keys through untouched", async () => {
  const secret = { kind: "api_key" as const, apiKey: "sk-test" };
  expect(
    await freshCodexSecret({
      credentialId: "row",
      credentialRevision: "rev",
      secret,
    }),
  ).toBe(secret);
});

it("force-refreshes a token ChatGPT rejected before its expiry", async () => {
  const fetch = vi.fn(async () =>
    Response.json({ access_token: jwt({ exp: now() + 3600 }) }),
  );
  vi.stubGlobal("fetch", fetch);
  const input = credential(now() + 3600);
  const secret = await freshCodexSecret(input, { force: true });
  expect(fetch).toHaveBeenCalledOnce();
  expect(secret).not.toBe(input.secret);
});

it("still defers to a running turn when forced", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.seat.mockResolvedValue({ surface: "gen2", ref: "session-1" });
  const input = credential(now() + 3600);
  expect(await freshCodexSecret(input, { force: true })).toBe(input.secret);
  expect(fetch).not.toHaveBeenCalled();
});
