import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => (model: string) => ({ model })),
}));

import { createAnthropic } from "@ai-sdk/anthropic";

import {
  createAgentModel,
  DEFAULT_OPENAI_MODEL,
  getOpenAIModel,
  getSelectableAgentModels,
  resolveSelectableAgentModel,
} from "./ai-model";

const createAnthropicMock = vi.mocked(createAnthropic);

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

describe("createAgentModel anthropic auth", () => {
  it("sends the OAuth beta header for a subscription token, not for an API key", () => {
    createAnthropicMock.mockClear();
    expect(() =>
      createAgentModel(
        {
          provider: "anthropic",
          source: "USER",
          authType: "OAUTH_TOKEN",
          apiKeyOrToken: "sk-ant-oat01-x",
        } as never,
        "claude-sonnet-4-5",
      ),
    ).toThrow(/subscription tokens cannot/);
    expect(createAnthropicMock).not.toHaveBeenCalled();

    createAnthropicMock.mockClear();
    createAgentModel(
      {
        provider: "anthropic",
        source: "USER",
        authType: "API_KEY",
        apiKeyOrToken: "sk-ant-api03-y",
      } as never,
      "claude-sonnet-4-5",
    );
    expect(createAnthropicMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "headers",
    );
  });
});

describe("OpenAI model configuration", () => {
  it("defaults to a documented model", () => {
    delete process.env.CODEV_OPENAI_MODEL;
    expect(getOpenAIModel()).toBe(DEFAULT_OPENAI_MODEL);
    expect(DEFAULT_OPENAI_MODEL).toBe("gpt-5.6-luna");
  });

  it("uses a configured model after trimming whitespace", () => {
    process.env.CODEV_OPENAI_MODEL = "  gpt-5.4-mini  ";
    expect(getOpenAIModel()).toBe("gpt-5.4-mini");
  });

  it("offers only recent GPT models when the provider list is unavailable", async () => {
    delete process.env.CODEV_OPENAI_MODEL;
    delete process.env.CODEV_AGENT_MODELS;
    expect(await getSelectableAgentModels("openai")).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
    ]);
    expect(await resolveSelectableAgentModel("gpt-5.4-mini", "openai")).toBe(
      "gpt-5.4-mini",
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
            { id: "gpt-5.6-luna", created: recent },
            { id: "gpt-5.6-sol", created: recent - 1 },
            { id: "gpt-4.1", created: old },
            { id: "gpt-5.6-realtime", created: recent },
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
      "gpt-5.6-luna",
      "gpt-5.6-sol",
    ]);
    expect(await getSelectableAgentModels("openai", credential)).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-sol",
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("supports an environment-controlled model allowlist", async () => {
    process.env.CODEV_AGENT_MODELS = "gpt-5.6-luna, custom-model, gpt-5.6-luna";
    expect(await getSelectableAgentModels("openai")).toEqual([
      "gpt-5.6-luna",
      "custom-model",
    ]);
  });
});
