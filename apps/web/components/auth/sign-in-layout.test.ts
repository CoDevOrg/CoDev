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
const adminGuard = readFileSync(
  resolve(process.cwd(), "lib/admin/admin.ts"),
  "utf8",
);
const credentialsSignInForm = readFileSync(
  resolve(process.cwd(), "components/auth/credentials-sign-in-form.tsx"),
  "utf8",
);
const globalsCss = readFileSync(
  resolve(process.cwd(), "app/globals.css"),
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

  it("keeps space between OAuth buttons and the email divider", () => {
    expect(globalsCss).toMatch(/\.auth-provider-stack\s*\{[^}]*gap:\s*16px/s);
    expect(globalsCss).not.toContain(
      ".auth-provider-stack form + .auth-divider",
    );
  });

  it("keeps sign-in available while account creation is paused", () => {
    expect(signInPage).toContain('dynamic = "force-dynamic"');
    expect(signInPage).toContain("sessionCheckUnavailable");
    expect(signInPage).toMatch(/You can still sign in\s+below\./);
    expect(signInPage).toContain("New accounts are paused");
    expect(signInPage).toContain("CredentialsSignin");
    expect(signInPage).toContain("CredentialsSignInForm");
    expect(signInPage).not.toContain("startInSignUp");
    expect(signInPage).toContain("assertCanRegister");
    expect(credentialsSignInForm).toContain('name="intent"');
    expect(credentialsSignInForm).toContain('value="sign-in"');
    expect(credentialsSignInForm).not.toContain("Create an account");
    expect(credentialsSignInForm).toContain("Sign in with email");
    expect(credentialsSignInForm).toContain('href="/forgot-password"');
    expect(credentialsSignInForm).not.toContain(
      "getNewAccountPasswordRequirements",
    );
    expect(signInPage).toContain("AuthError");
    expect(signInErrorPage).toContain("We could not load sign-in.");
    expect(signInErrorPage).toContain("Try again");
  });

  it("preserves the admin deep link through sign-in", () => {
    expect(adminGuard).toContain('requireUser("/admin")');
    expect(signInPage).toContain("if (session?.user) redirect(safeCallback);");
  });
});
