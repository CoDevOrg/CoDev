import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_OPENAI_MODEL,
  getOpenAIModel,
  getSelectableAgentModels,
  resolveSelectableAgentModel,
} from "./ai-model";

const originalModel = process.env.CODEV_OPENAI_MODEL;
const originalModels = process.env.CODEV_AGENT_MODELS;

afterEach(() => {
  vi.useRealTimers();
  if (originalModel === undefined) {
    delete process.env.CODEV_OPENAI_MODEL;
  } else {
    process.env.CODEV_OPENAI_MODEL = originalModel;
  }
  if (originalModels === undefined) {
    delete process.env.CODEV_AGENT_MODELS;
  } else {
    process.env.CODEV_AGENT_MODELS = originalModels;
  }
});

describe("OpenAI model configuration", () => {
  it("defaults to a documented model", () => {
    delete process.env.CODEV_OPENAI_MODEL;
    expect(getOpenAIModel()).toBe(DEFAULT_OPENAI_MODEL);
    expect(DEFAULT_OPENAI_MODEL).toBe("gpt-5");
  });

  it("uses a configured model after trimming whitespace", () => {
    process.env.CODEV_OPENAI_MODEL = "  gpt-5-mini  ";
    expect(getOpenAIModel()).toBe("gpt-5-mini");
  });

  it("offers only recent GPT models when the provider list is unavailable", async () => {
    delete process.env.CODEV_OPENAI_MODEL;
    delete process.env.CODEV_AGENT_MODELS;
    expect(await getSelectableAgentModels("openai")).toEqual([
      "gpt-5",
      "gpt-5.2",
      "gpt-5.2-pro",
      "gpt-5.2-codex",
      "gpt-5.1",
      "gpt-5.1-codex",
      "gpt-5.1-codex-mini",
      "gpt-5-pro",
      "gpt-5-mini",
      "gpt-5-nano",
    ]);
    expect(await resolveSelectableAgentModel("gpt-5-mini", "openai")).toBe(
      "gpt-5-mini",
    );
    await expect(
      resolveSelectableAgentModel("unknown", "openai"),
    ).rejects.toThrow("not available");
  });

  it("fetches and caches recent text-capable GPT models", async () => {
    const now = new Date("2026-08-02T00:00:00.000Z");
    const recent = Math.floor(
      new Date("2025-08-03T00:00:00.000Z").getTime() / 1_000,
    );
    const old = Math.floor(
      new Date("2025-08-01T00:00:00.000Z").getTime() / 1_000,
    );
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "gpt-5.2", created: recent },
            { id: "gpt-5.1-codex", created: recent - 1 },
            { id: "gpt-4.1", created: old },
            { id: "gpt-5.2-realtime", created: recent },
          ],
        }),
      }),
    );
    const credential = {
      provider: "openai",
      source: "USER",
      authType: "API_KEY",
      apiKeyOrToken: "test-token",
      credentialId: "credential-1",
    } as const;

    expect(await getSelectableAgentModels("openai", credential)).toEqual([
      "gpt-5.2",
      "gpt-5.1-codex",
    ]);
    expect(await getSelectableAgentModels("openai", credential)).toEqual([
      "gpt-5.2",
      "gpt-5.1-codex",
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("supports an environment-controlled model allowlist", async () => {
    process.env.CODEV_AGENT_MODELS = "gpt-5, custom-model, gpt-5";
    expect(await getSelectableAgentModels("openai")).toEqual([
      "gpt-5",
      "custom-model",
    ]);
  });
});
