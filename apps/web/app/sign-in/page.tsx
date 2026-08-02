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
        <p className="eyebrow">Sign in</p>
        <h1>Welcome to CoDev.</h1>
        <p>
          Sign in with your name, email, and password, or continue with Google
          or GitHub.
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
              className="auth-credentials-form"
              action={async (formData) => {
                "use server";
                await signIn("credentials", {
                  name: String(formData.get("name") ?? ""),
                  email: String(formData.get("email") ?? ""),
                  password: String(formData.get("password") ?? ""),
                  redirectTo: safeCallback,
                });
              }}
            >
              <label>
                <span>Name</span>
                <input
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Your name"
                  required
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                />
              </label>
              <button className="auth-submit" type="submit">
                Continue with email
              </button>
            </form>

            <div className="auth-divider" aria-hidden="true">
              <span>or</span>
            </div>

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
                Continue with Google
              </button>
            </form>

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
                Continue with GitHub
              </button>
            </form>

            {!googleConfigured || !githubConfigured ? (
              <div className="setup-panel">
                <strong>OAuth setup pending</strong>
                <p>
                  Add the provider credentials and secure token-storage key to
                  enable the corresponding sign-in option. Repository access can
                  be connected afterward.
                </p>
              </div>
            ) : null}
          </div>
        )}

        <small>
          GitHub repository access can be connected after you sign in.
        </small>
      </section>
    </main>
  );
}
