import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const signInPage = readFileSync(
  resolve(process.cwd(), "app/sign-in/page.tsx"),
  "utf8",
);
const signInErrorPage = readFileSync(
  resolve(process.cwd(), "app/sign-in/error.tsx"),
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

  it("keeps a recoverable sign-in experience and explains the new password policy", () => {
    expect(signInPage).toContain('dynamic = "force-dynamic"');
    expect(signInPage).toContain("sessionCheckUnavailable");
    expect(signInPage).toContain(
      "You can still sign in or\n            create an account below.",
    );
    expect(signInPage).toContain(
      "New accounts need a 15+ character passphrase.",
    );
    expect(signInErrorPage).toContain("We could not load sign-in.");
    expect(signInErrorPage).toContain("Try again");
  });
});
