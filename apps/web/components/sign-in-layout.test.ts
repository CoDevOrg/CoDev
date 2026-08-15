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
const credentialsSignInForm = readFileSync(
  resolve(process.cwd(), "components/credentials-sign-in-form.tsx"),
  "utf8",
);

describe("sign-in provider layout", () => {
  it("places OAuth providers before the email form and omits setup messaging", () => {
    expect(signInPage.indexOf("auth-oauth-buttons")).toBeLessThan(
      signInPage.lastIndexOf("CredentialsSignInForm"),
    );
    expect(signInPage).toContain("<GoogleMark />");
    expect(signInPage).toContain("<GitHubMark />");
    expect(signInPage).not.toContain("OAuth setup pending");
  });

  it("keeps a recoverable sign-in experience and a separate create-account path", () => {
    expect(signInPage).toContain('dynamic = "force-dynamic"');
    expect(signInPage).toContain("sessionCheckUnavailable");
    expect(signInPage).toContain(
      "You can still sign in or\n            create an account below.",
    );
    expect(signInPage).toContain("CredentialsSignin");
    expect(signInPage).toContain("CredentialsSignInForm");
    expect(signInPage).toContain('initialMode={mode === "sign-up"');
    expect(credentialsSignInForm).toContain('name="intent"');
    expect(credentialsSignInForm).toContain("Create an account");
    expect(credentialsSignInForm).toContain("Sign in with email");
    expect(credentialsSignInForm).toContain('href="/forgot-password"');
    expect(credentialsSignInForm).toContain(
      'aria-label="New account password requirements"',
    );
    expect(credentialsSignInForm).toContain(
      "getNewAccountPasswordRequirements",
    );
    expect(signInPage).toContain("AuthError");
    expect(signInErrorPage).toContain("We could not load sign-in.");
    expect(signInErrorPage).toContain("Try again");
  });
});
