import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GEN2_PROVIDER_MODELS } from "@codev/contracts";
import {
  clearDynamicModelCache,
  getDynamicModelsForProvider,
} from "./dynamic-models";

describe("dynamic models discovery", () => {
  beforeEach(() => {
    clearDynamicModelCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearDynamicModelCache();
    vi.restoreAllMocks();
  });

  it("extracts and formats Claude models from public catalog", async () => {
    const mockCatalog = [
      {
        id: "anthropic/claude-sonnet-5.5",
        name: "Anthropic: Claude Sonnet 5.5",
        created: 1790618686,
        description: "Claude Sonnet 5.5 is Anthropic's latest model.",
      },
      {
        id: "anthropic/claude-sonnet-5.5:batch",
        name: "Anthropic: Claude Sonnet 5.5 (batch)",
        created: 1790618686,
      },
      {
        id: "openai/gpt-5.6-luna",
        name: "OpenAI: GPT-5.6 Luna",
        created: 1780000000,
      },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: mockCatalog }), { status: 200 }),
    );

    const models = await getDynamicModelsForProvider("claude");
    expect(models).toHaveLength(1);
    expect(models[0]).toEqual({
      id: "claude-sonnet-5.5",
      label: "Claude Sonnet 5.5",
      description: "Claude Sonnet 5.5 is Anthropic's latest model.…",
    });
  });

  it("extracts and formats Codex/OpenAI models, filtering audio/image/batch", async () => {
    const mockCatalog = [
      {
        id: "openai/gpt-5.6-luna",
        name: "OpenAI: GPT-5.6 Luna",
        created: 1780000000,
        description: "Fast reasoning model.",
      },
      {
        id: "openai/gpt-5.6-luna:batch",
        name: "OpenAI: GPT-5.6 Luna (batch)",
        created: 1780000000,
      },
      {
        id: "openai/gpt-audio",
        name: "OpenAI: Audio",
        created: 1770000000,
      },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: mockCatalog }), { status: 200 }),
    );

    const models = await getDynamicModelsForProvider("codex");
    expect(models).toHaveLength(1);
    expect(models[0]).toEqual({
      id: "gpt-5.6-luna",
      label: "GPT-5.6 Luna",
      description: "Fast reasoning model.…",
    });
  });

  it("caches results and does not refetch immediately", async () => {
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "anthropic/claude-3-7-sonnet",
              name: "Anthropic: Claude 3.7 Sonnet",
              created: 1750000000,
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await getDynamicModelsForProvider("claude");
    await getDynamicModelsForProvider("claude");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to GEN2_PROVIDER_MODELS when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const models = await getDynamicModelsForProvider("claude");
    expect(models).toEqual(GEN2_PROVIDER_MODELS.claude);
  });
});
