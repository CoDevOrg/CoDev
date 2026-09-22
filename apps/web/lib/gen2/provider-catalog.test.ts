import { describe, expect, it } from "vitest";

import {
  gen2ProviderCatalog,
  getGen2ProviderDefinition,
} from "./provider-catalog";

describe("Gen 2 provider catalog", () => {
  it("distinguishes known providers from installed execution adapters", () => {
    expect(gen2ProviderCatalog.map((provider) => provider.id)).toEqual([
      "openai",
      "anthropic",
      "cursor",
    ]);
    expect(getGen2ProviderDefinition("openai")).toMatchObject({
      installed: true,
      capabilities: { canRun: true, canStreamActivity: true },
    });
    expect(getGen2ProviderDefinition("anthropic")).toMatchObject({
      installed: false,
      capabilities: { canRun: false },
    });
  });
});
