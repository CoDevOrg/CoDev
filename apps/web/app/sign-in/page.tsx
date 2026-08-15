import type { Metadata } from "next";
import type { Session } from "next-auth";
import { AuthError } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { isGitHubAuthConfigured, isGoogleAuthConfigured } from "@codev/config";

import { auth, signIn } from "@/auth";
import { Brand } from "@/components/app-chrome";
import { ClerkSignIn } from "@/components/clerk-sign-in";
import { CredentialsSignInForm } from "@/components/credentials-sign-in-form";
import { clerkAuthConfigured } from "@/lib/identity";

export const metadata: Metadata = {
  title: "Sign in",
};

// This route reads the signed-in cookie so it can redirect active users.
// Explicit dynamic rendering prevents an unsuccessful static pass from ever
// becoming the browser's error page.
export const dynamic = "force-dynamic";

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="oauth-provider-mark" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.19-.2-1.69H12v3.55h5.52c-.11.88-.71 2.21-2.04 3.1l-.02.12 2.97 2.3.21.02c1.92-1.77 2.96-4.38 2.96-7.4Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.97-.89 6.63-2.41l-3.16-2.44c-.84.59-1.97 1-3.47 1a6 6 0 0 1-5.68-4.14l-.11.01-3.08 2.39-.04.11A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.32 14.03A6.2 6.2 0 0 1 6 12c0-.71.12-1.4.31-2.03v-.14L3.19 7.4l-.1.05A10 10 0 0 0 2 12c0 1.64.39 3.2 1.08 4.55l3.24-2.52Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.87c1.89 0 3.17.82 3.9 1.5l2.85-2.78C16.96 2.95 14.7 2 12 2a10 10 0 0 0-8.91 5.45l3.22 2.52A6 6 0 0 1 12 5.87Z"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg aria-hidden="true" className="oauth-provider-mark" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-3.16 19.49c.5.1.68-.22.68-.48v-1.7c-2.77.6-3.35-1.18-3.35-1.18-.45-1.15-1.11-1.46-1.11-1.46-.9-.62.07-.61.07-.61 1 .07 1.52 1.03 1.52 1.03.89 1.52 2.33 1.08 2.9.83.09-.64.35-1.08.63-1.33-2.21-.25-4.54-1.1-4.54-4.92 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.8c.85 0 1.7.11 2.5.34 1.91-1.3 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.83-2.33 4.67-4.55 4.92.36.31.67.9.67 1.82v2.7c0 .26.18.58.69.48A10 10 0 0 0 12 2Z"
      />
    </svg>
  );
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
    mode?: string;
  }>;
}) {
  const clerkEnabled = clerkAuthConfigured();
  let session: Session | null = null;
  let sessionCheckUnavailable = false;
  if (!clerkEnabled) {
    try {
      session = await auth();
    } catch (sessionError) {
      // Rendering sign-in must remain available even if session verification
      // has a transient infrastructure failure.
      console.error("Unable to check the CoDev sign-in session.", sessionError);
      sessionCheckUnavailable = true;
    }
  }
  if (session?.user) redirect("/dashboard");

  const { callbackUrl, error, mode } = await searchParams;
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
          Continue with Google or GitHub, or sign in with the email you already
          use. New to CoDev? Create an account below.
        </p>

        {sessionCheckUnavailable ? (
          <div className="inline-alert error" role="alert">
            We could not check your existing session. You can still sign in or
            create an account below.
          </div>
        ) : null}

        {error ? (
          <div className="inline-alert error" role="alert">
            That email or password did not work. Sign in with your existing
            account, or create a new one below.
          </div>
        ) : null}

        {clerkEnabled ? (
          <ClerkSignIn redirectUrl={safeCallback} />
        ) : (
          <div className="auth-provider-stack">
            <div className="auth-oauth-buttons">
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
                  <GoogleMark />
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
                  <GitHubMark />
                  Continue with GitHub
                </button>
              </form>
            </div>

            <div className="auth-divider" aria-hidden="true">
              <span>or use email</span>
            </div>

            <CredentialsSignInForm
              initialMode={mode === "sign-up" ? "sign-up" : "sign-in"}
              action={async (formData) => {
                "use server";
                const intent = String(formData.get("intent") ?? "sign-in");
                try {
                  await signIn("credentials", {
                    intent,
                    name: String(formData.get("name") ?? ""),
                    email: String(formData.get("email") ?? ""),
                    password: String(formData.get("password") ?? ""),
                    redirectTo: safeCallback,
                  });
                } catch (signInError) {
                  if (
                    signInError instanceof AuthError &&
                    signInError.type === "CredentialsSignin"
                  ) {
                    const nextMode =
                      intent === "sign-up" ? "sign-up" : "sign-in";
                    redirect(
                      `/sign-in?error=CredentialsSignin&mode=${nextMode}&callbackUrl=${encodeURIComponent(safeCallback)}`,
                    );
                  }

                  throw signInError;
                }
              }}
            />
          </div>
        )}

        <small>
          GitHub repository access can be connected after you sign in.
        </small>
      </section>
    </main>
  );
}
