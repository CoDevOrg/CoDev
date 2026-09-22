import { describe, expect, it, vi } from "vitest";

vi.mock("./providers/openai", () => ({
  openAiGen2ProviderAdapter: { id: "openai" },
}));

import { Gen2LifecycleError } from "./errors";
import { getGen2ProviderAdapter } from "./provider-adapters";

describe("Gen 2 provider adapters", () => {
  it("registers the OpenAI adapter but rejects uninstalled providers clearly", () => {
    expect(getGen2ProviderAdapter("openai").id).toBe("openai");
    expect(() => getGen2ProviderAdapter("anthropic")).toThrow(
      Gen2LifecycleError,
    );
    expect(() => getGen2ProviderAdapter("anthropic")).toThrow(
      /not available in Gen 2 yet/,
    );
  });
});
