import { describe, expect, it } from "vitest";

import {
  INTERRUPT_UNAVAILABLE_EXPLANATION,
  QUEUE_UNAVAILABLE_EXPLANATION,
  RESTRICTED_FIXTURE_PROVIDER,
  capabilitiesForProvider,
  isSelectableSharedProvider,
  listProviderCapabilities,
  unavailableControlExplanation,
} from "./provider-capabilities";

describe("provider capabilities", () => {
  it("marks OpenAI queue, interrupt, and controlled turns as available", () => {
    const capabilities = capabilitiesForProvider("openai");
    expect(capabilities).toMatchObject({
      id: "openai",
      label: "OpenAI",
      canQueue: true,
      canInterrupt: true,
      canStartControlled: true,
    });
    expect(unavailableControlExplanation("openai", "queue")).toBeNull();
    expect(unavailableControlExplanation("openai", "interrupt")).toBeNull();
  });

  it("disables queue and interrupt on the restricted fixture provider", () => {
    const capabilities = capabilitiesForProvider(RESTRICTED_FIXTURE_PROVIDER);
    expect(capabilities.canQueue).toBe(false);
    expect(capabilities.canInterrupt).toBe(false);
    expect(capabilities.canStartControlled).toBe(true);
    expect(unavailableControlExplanation(RESTRICTED_FIXTURE_PROVIDER, "queue")).toBe(
      QUEUE_UNAVAILABLE_EXPLANATION,
    );
    expect(
      unavailableControlExplanation(RESTRICTED_FIXTURE_PROVIDER, "interrupt"),
    ).toBe(INTERRUPT_UNAVAILABLE_EXPLANATION);
  });

  it("lists selectable providers with the current selection flagged", () => {
    const listed = listProviderCapabilities(RESTRICTED_FIXTURE_PROVIDER);
    expect(listed.map((item) => [item.id, item.selected])).toEqual([
      ["openai", false],
      [RESTRICTED_FIXTURE_PROVIDER, true],
    ]);
    expect(isSelectableSharedProvider("openai")).toBe(true);
    expect(isSelectableSharedProvider("restricted")).toBe(true);
    expect(isSelectableSharedProvider("anthropic")).toBe(false);
  });
});
