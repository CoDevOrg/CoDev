import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { isGitHubAuthConfigured } from "@codev/config";

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
  const configured = isGitHubAuthConfigured();
  const safeCallback =
    callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/dashboard";

  return (
    <main className="auth-page">
      <div className="auth-nav">
        <Brand />
        <Link href="/workspaces/demo">View demo</Link>
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
            GitHub sign-in did not complete. Please try again.
          </div>
        ) : null}

        {clerkEnabled ? (
          <ClerkSignIn redirectUrl={safeCallback} />
        ) : configured ? (
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: safeCallback });
            }}
          >
            <button className="github-button" type="submit">
              <span aria-hidden="true">⑂</span>
              Continue with GitHub
            </button>
          </form>
        ) : (
          <div className="setup-panel">
            <strong>GitHub App setup pending</strong>
            <p>
              The website is live, but an owner must add the GitHub App client
              ID and secret before sign-in can begin.
            </p>
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
