import { expect, it } from "vitest";
import { hasSafeBrowserMutationOrigin } from "./browser-mutation-origin";

function request(
  path: string,
  origin?: string,
  cookie = "__Host-codev.session-token=valid",
  authorization?: string,
) {
  return new Request(`https://trycodev.com${path}`, {
    method: "POST",
    headers: {
      cookie,
      ...(origin ? { origin } : {}),
      ...(authorization ? { authorization } : {}),
    },
  });
}
it.each([
  undefined,
  "null",
  "https://runtime.trycodev.com",
  "https://evil.example",
])("rejects cookie mutations with Origin %s", (origin) => {
  expect(
    hasSafeBrowserMutationOrigin(request("/api/personal/connections", origin)),
  ).toBe(false);
});
it("does not allow an Authorization header to bypass cookie origin checks", () => {
  expect(
    hasSafeBrowserMutationOrigin(
      request(
        "/api/settings/openai-key",
        undefined,
        "__Host-codev.session-token.0=valid",
        "Bearer fake",
      ),
    ),
  ).toBe(false);
});
it("allows same-origin browser and cookie-free CLI requests", () => {
  expect(
    hasSafeBrowserMutationOrigin(
      request("/api/personal/connections", "https://trycodev.com"),
    ),
  ).toBe(true);
  expect(
    hasSafeBrowserMutationOrigin(
      request("/api/cli/codex-auth", undefined, "", "Bearer codev_cli_token"),
    ),
  ).toBe(true);
});
it("retains Auth.js callback and signed Stripe webhook behavior", () => {
  expect(
    hasSafeBrowserMutationOrigin(request("/api/auth/callback/github")),
  ).toBe(true);
  expect(hasSafeBrowserMutationOrigin(request("/api/billing/webhook"))).toBe(
    true,
  );
  expect(
    hasSafeBrowserMutationOrigin(request("/api/auth/oauth/codex/session")),
  ).toBe(false);
});
