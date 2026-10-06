import { beforeEach, expect, it, vi } from "vitest";
import { getCodexAccountModels } from "./codex-account-models";
import { getCursorAccountModels } from "./cursor-account-models";
import type { ResolvedSecret } from "./registry";
const jwt = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } })).toString("base64url")}.signature`;
const codex: ResolvedSecret = {
  kind: "codex_auth_cache",
  authCacheJson: JSON.stringify({
    tokens: { access_token: "secret", id_token: jwt, account_id: "account" },
  }),
};
beforeEach(() => vi.restoreAllMocks());
it("shows only the connected Codex plan's visible models and uses its account routing", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      models: [
        {
          slug: "allowed",
          display_name: "Allowed",
          visibility: "list",
          priority: 2,
          available_in_plans: ["plus"],
        },
        {
          slug: "hidden",
          display_name: "Hidden",
          visibility: "hide",
          priority: 0,
        },
        {
          slug: "pro-only",
          display_name: "Pro only",
          visibility: "list",
          priority: 1,
          available_in_plans: ["pro"],
        },
      ],
    }),
  );
  expect(await getCodexAccountModels(codex)).toEqual([
    { id: "allowed", label: "Allowed" },
  ]);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("chatgpt.com/backend-api/codex/models"),
    expect.objectContaining({
      headers: expect.objectContaining({
        "ChatGPT-Account-Id": "account",
        authorization: "Bearer secret",
      }),
      redirect: "manual",
    }),
  );
});
it("does not guess plan access when the saved token has no plan claim", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      models: [
        {
          slug: "restricted",
          display_name: "Restricted",
          visibility: "list",
          priority: 1,
          available_in_plans: ["pro"],
        },
      ],
    }),
  );
  expect(
    await getCodexAccountModels({
      kind: "codex_auth_cache",
      authCacheJson: JSON.stringify({ tokens: { access_token: "opaque" } }),
    }),
  ).toEqual([]);
});
it("returns Cursor's named options and applies its account restriction to variants", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
    Response.json(
      String(url).includes("GetUsableModels")
        ? {
            models: [
              {
                modelId: "default",
                displayModelId: "auto",
                displayName: "Auto",
              },
              { modelId: "allowed-high", displayName: "Allowed high" },
              { modelId: "disabled", displayName: "Disabled" },
            ],
          }
        : {
            models: [
              { name: "allowed", variants: [{ legacySlug: "allowed-high" }] },
            ],
            displayConfiguration: {
              modelSelectionRestrictionMessage: "Restricted account",
            },
          },
    ),
  );
  expect(
    await getCursorAccountModels({
      kind: "cursor_auth_cache",
      authCacheJson: '{"accessToken":"secret"}',
    }),
  ).toEqual([{ id: "allowed-high", label: "Allowed high" }]);
});
it("keeps provider-reported Auto optional rather than the default or only choice", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
    Response.json(
      String(url).includes("GetUsableModels")
        ? {
            models: [
              {
                modelId: "default",
                displayModelId: "auto",
                displayName: "Auto",
              },
              { modelId: "named", displayName: "Named" },
            ],
          }
        : { models: [] },
    ),
  );
  expect(
    await getCursorAccountModels({
      kind: "cursor_auth_cache",
      authCacheJson: '{"accessToken":"secret"}',
    }),
  ).toEqual([
    { id: "named", label: "Named" },
    { id: "auto", label: "Auto" },
  ]);
});
it("exchanges Cursor API keys before requesting that account's catalog", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) =>
      Response.json(
        String(url).includes("exchange_user_api_key")
          ? { accessToken: "exchanged" }
          : String(url).includes("GetUsableModels")
            ? { models: [{ modelId: "named" }] }
            : { models: [] },
      ),
    );
  await getCursorAccountModels({ kind: "api_key", apiKey: "private-key" });
  expect(
    fetch.mock.calls
      .slice(1)
      .every(
        ([, init]) =>
          (init?.headers as Record<string, string>).authorization ===
          "Bearer exchanged",
      ),
  ).toBe(true);
});
it("does not expose provider response bodies on authentication failure", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("private-response-token", { status: 401 }),
  );
  await expect(getCodexAccountModels(codex)).rejects.toThrow(
    "Account model discovery is unavailable.",
  );
});
it("rejects redirects without forwarding the account credential", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "https://example.com/credential-target" },
    }),
  );
  await expect(getCodexAccountModels(codex)).rejects.toThrow(
    "Account model discovery is unavailable.",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
});
