export const OPENAI_OAUTH_FIXTURE_CODE = "codev-f65-fixture-callback";
export const OPENAI_OAUTH_FIXTURE_ACCESS_TOKEN =
  "oa-test-codev-f65-fixture-token-fx01";
export const OPENAI_OAUTH_FIXTURE_REFRESH_TOKEN =
  "oa-test-codev-f65-fixture-refresh-fx01";
export const OPENAI_OAUTH_FIXTURE_LAST_FOUR = "fx01";

export function isOpenAiOAuthFixtureCode(code: string) {
  return code.trim() === OPENAI_OAUTH_FIXTURE_CODE;
}

export function fixtureOpenAiOAuthTokens() {
  return {
    accessToken: OPENAI_OAUTH_FIXTURE_ACCESS_TOKEN,
    refreshToken: OPENAI_OAUTH_FIXTURE_REFRESH_TOKEN,
    lastFour: OPENAI_OAUTH_FIXTURE_LAST_FOUR,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
}
