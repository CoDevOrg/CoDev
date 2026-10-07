import { expect, it } from "vitest";
import { clearLegacySessionCookies } from "./clear-legacy-session-cookies";
it("expires only the old domain-wide session cookies, including chunks", () => {
  const response = new Response();
  clearLegacySessionCookies(
    new Request("https://www.trycodev.com/sign-in", {
      headers: {
        cookie:
          "__Secure-codev.session-token.0=secret; __Secure-codev.session-token.1=secret; __Host-codev.session-token=new; preference=dark",
      },
    }),
    response,
  );
  expect(response.headers.getSetCookie()).toEqual([
    "__Secure-codev.session-token.0=; Domain=trycodev.com; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    "__Secure-codev.session-token.1=; Domain=trycodev.com; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
  ]);
});
it("leaves development and preview cookie domains unchanged", () => {
  const response = new Response();
  clearLegacySessionCookies(
    new Request("http://127.0.0.1:3000", {
      headers: { cookie: "__Secure-codev.session-token=secret" },
    }),
    response,
  );
  expect(response.headers.getSetCookie()).toEqual([]);
});
