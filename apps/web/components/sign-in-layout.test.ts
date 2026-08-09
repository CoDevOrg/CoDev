import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const signInPage = readFileSync(
  resolve(process.cwd(), "app/sign-in/page.tsx"),
  "utf8",
);

describe("sign-in provider layout", () => {
  it("places OAuth providers before the email form and omits setup messaging", () => {
    expect(signInPage.indexOf("auth-oauth-buttons")).toBeLessThan(
      signInPage.indexOf("auth-credentials-form"),
    );
    expect(signInPage).toContain("<GoogleMark />");
    expect(signInPage).toContain("<GitHubMark />");
    expect(signInPage).not.toContain("OAuth setup pending");
  });
});
