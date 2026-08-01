import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { isGitHubAuthConfigured, isGoogleAuthConfigured } from "@codev/config";

import { auth, signIn } from "@/auth";
import { Brand } from "@/components/app-chrome";
import { ClerkSignIn } from "@/components/clerk-sign-in";
import { clerkAuthConfigured } from "@/lib/identity";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const clerkEnabled = clerkAuthConfigured();
  const session = clerkEnabled ? null : await auth();
  if (session?.user) redirect("/dashboard");

  const { callbackUrl, error } = await searchParams;
  const githubConfigured = isGitHubAuthConfigured();
  const googleConfigured = isGoogleAuthConfigured();
  const safeCallback =
    callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/dashboard";

  return (
    <main className="auth-page">
      <div className="auth-nav">
        <Brand />
        <Link href="/">Back</Link>
      </div>
      <section className="auth-card">
        <span className="auth-glyph" aria-hidden="true">
          ⑂
        </span>
        <p className="eyebrow">Secure SSO</p>
        <h1>Open your CoDev workspace.</h1>
        <p>
          Sign in with Google or GitHub. GitHub repository access is connected
          separately, and CoDev never sends your GitHub token to a sandbox.
        </p>

        {error ? (
          <div className="inline-alert error" role="alert">
            Sign-in did not complete. Please try again.
          </div>
        ) : null}

        {clerkEnabled ? (
          <ClerkSignIn redirectUrl={safeCallback} />
        ) : (
          <div className="auth-provider-stack">
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: safeCallback });
              }}
            >
              <button
                className="google-button"
                type="submit"
                disabled={!googleConfigured}
              >
                <span className="google-mark" aria-hidden="true">
                  G
                </span>
                Continue with Google
              </button>
            </form>

            <div className="auth-divider" aria-hidden="true">
              <span>or</span>
            </div>

            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: safeCallback });
              }}
            >
              <button
                className="github-button"
                type="submit"
                disabled={!githubConfigured}
              >
                <span aria-hidden="true">⑂</span>
                Continue with GitHub
              </button>
            </form>

            {!googleConfigured || !githubConfigured ? (
              <div className="setup-panel">
                <strong>OAuth setup pending</strong>
                <p>
                  Add the provider credentials to enable the corresponding
                  sign-in option. Google accounts do not need GitHub access;
                  repository access can be connected afterward.
                </p>
              </div>
            ) : null}
          </div>
        )}

        <small>
          Requested access is limited by the repositories selected during GitHub
          App installation.
        </small>
      </section>
    </main>
  );
}
