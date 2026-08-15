import { describe, expect, it } from "vitest";

import {
  OPENAI_OAUTH_FIXTURE_ACCESS_TOKEN,
  OPENAI_OAUTH_FIXTURE_CODE,
  fixtureOpenAiOAuthTokens,
  isOpenAiOAuthFixtureCode,
} from "./provider-oauth-fixture";

describe("OpenAI OAuth fixture callback", () => {
  it("accepts only the documented fixture callback code", () => {
    expect(isOpenAiOAuthFixtureCode(OPENAI_OAUTH_FIXTURE_CODE)).toBe(true);
    expect(isOpenAiOAuthFixtureCode("real-chatgpt-code")).toBe(false);
  });

  it("returns fixture tokens that end in fx01 and never look like a ChatGPT authorize URL", () => {
    const tokens = fixtureOpenAiOAuthTokens();
    expect(tokens.lastFour).toBe("fx01");
    expect(tokens.accessToken).toBe(OPENAI_OAUTH_FIXTURE_ACCESS_TOKEN);
    expect(tokens.accessToken.endsWith("fx01")).toBe(true);
    expect(JSON.stringify(tokens)).not.toMatch(/auth\.openai\.com|authorize/i);
  });
});
