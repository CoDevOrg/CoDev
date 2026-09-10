import { afterEach, describe, expect, it, vi } from "vitest";
import { getAnthropicModels } from "./anthropic-models";
import {
  getSelectableAgentModels,
  resolveSelectableAgentModel,
} from "./ai-model";
import type { ResolvedCredential } from "./credentials";

const connection: ResolvedCredential = {
  provider: "anthropic",
  source: "USER",
  authType: "OAUTH_TOKEN",
  apiKeyOrToken: "test-secret",
};
const response = (ids: string[], has_more = false) =>
  new Response(
    JSON.stringify({
      data: ids.map((id) => ({ id })),
      has_more,
      last_id: ids.at(-1) ?? null,
    }),
  );

afterEach(() => vi.unstubAllGlobals());

describe("Claude model discovery", () => {
  it("uses provider IDs and caches per connection, not per user request", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(response(["claude-sonnet-5", "claude-opus-5"]));
    vi.stubGlobal("fetch", fetch);
    const credential = { ...connection, credentialId: "cached-test" };
    expect(await getSelectableAgentModels("anthropic", credential)).toEqual([
      "claude-sonnet-5",
      "claude-opus-5",
    ]);
    expect(
      await resolveSelectableAgentModel(undefined, "anthropic", credential),
    ).toBe("claude-sonnet-5");
    await expect(
      resolveSelectableAgentModel("claude-invented", "anthropic", credential),
    ).rejects.toThrow("not available");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models?limit=1000",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer test-secret",
        }),
      }),
    );
  });

  it("follows pagination and does not share catalogs across credentials", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(["claude-sonnet-5"], true))
      .mockResolvedValueOnce(response(["claude-opus-5"]))
      .mockResolvedValueOnce(response(["claude-haiku-4-5-20251001"]));
    vi.stubGlobal("fetch", fetch);
    expect(
      await getAnthropicModels({ ...connection, credentialId: "page-test" }),
    ).toHaveLength(2);
    expect(fetch.mock.calls[1]?.[0]).toContain("after_id=claude-sonnet-5");
    expect(
      await getAnthropicModels({ ...connection, credentialId: "other-test" }),
    ).toEqual(["claude-haiku-4-5-20251001"]);
  });

  it.each([
    new Response("failure", { status: 429 }),
    new Response("{}"),
    response([]),
  ])("does not fabricate models when discovery fails", async (result) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(result));
    await expect(getAnthropicModels(connection)).rejects.toThrow();
  });
});
