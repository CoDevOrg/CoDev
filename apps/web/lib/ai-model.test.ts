import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_OPENAI_MODEL, getOpenAIModel } from "./ai-model";

const originalModel = process.env.CODEV_OPENAI_MODEL;

afterEach(() => {
  if (originalModel === undefined) {
    delete process.env.CODEV_OPENAI_MODEL;
  } else {
    process.env.CODEV_OPENAI_MODEL = originalModel;
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
});
