import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_OPENAI_MODEL,
  getOpenAIModel,
  getSelectableAgentModels,
  resolveSelectableAgentModel,
} from "./ai-model";

const originalModel = process.env.CODEV_OPENAI_MODEL;
const originalModels = process.env.CODEV_AGENT_MODELS;

afterEach(() => {
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

  it("offers a bounded list of selectable OpenAI models", () => {
    delete process.env.CODEV_OPENAI_MODEL;
    delete process.env.CODEV_AGENT_MODELS;
    expect(getSelectableAgentModels("openai")).toEqual([
      "gpt-5",
      "gpt-5-mini",
      "gpt-5-nano",
    ]);
    expect(resolveSelectableAgentModel("gpt-5-mini", "openai")).toBe(
      "gpt-5-mini",
    );
    expect(() => resolveSelectableAgentModel("unknown", "openai")).toThrow(
      "not available",
    );
  });

  it("supports an environment-controlled model allowlist", () => {
    process.env.CODEV_AGENT_MODELS = "gpt-5, custom-model, gpt-5";
    expect(getSelectableAgentModels("openai")).toEqual([
      "gpt-5",
      "custom-model",
    ]);
  });
});
