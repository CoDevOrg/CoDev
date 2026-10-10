import type { Metadata } from "next";
import { AuthError, type CredentialsSignin } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Brand } from "@/components/shell/app-chrome";
import {
  readTwoFactorChallenge,
  safeCallbackPath,
  twoFactorChallengePath,
} from "@/lib/auth/two-factor-challenge";

export const metadata: Metadata = {
  title: "Two-factor authentication",
};

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid_code:
    "That code did not work. Enter the current 6-digit code from your authenticator app, or an unused recovery code.",
  rate_limited: "Too many codes tried. Wait 15 minutes, then sign in again.",
};

export default async function TwoFactorSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const destination = safeCallbackPath(callbackUrl);
  const session = await auth().catch(() => null);
  if (session?.user) redirect(destination);
  const challenge = await readTwoFactorChallenge();

  return (
    <main className="auth-page">
      <div className="auth-nav">
        <Brand />
        <Link href="/sign-in">Sign in</Link>
      </div>
      <section className="auth-card">
        <p className="eyebrow">Two-factor authentication</p>
        {challenge && error !== "expired" ? (
          <>
            <h1>Enter your code.</h1>
            <p>
              Open your authenticator app and enter the 6-digit code for CoDev.
              Lost your device? Enter one of your recovery codes instead.
            </p>
            {error && ERRORS[error] ? (
              <div className="inline-alert error" role="alert">
                {ERRORS[error]}
              </div>
            ) : null}
            <form
              className="auth-credentials-form"
              action={async (formData) => {
                "use server";
                try {
                  await signIn("two-factor", {
                    code: String(formData.get("code") ?? ""),
                    redirectTo: destination,
                  });
                } catch (signInError) {
                  if (
                    signInError instanceof AuthError &&
                    signInError.type === "CredentialsSignin"
                  ) {
                    const code = (signInError as CredentialsSignin).code;
                    redirect(
                      `${twoFactorChallengePath(destination)}&error=${encodeURIComponent(code)}`,
                    );
                  }
                  throw signInError;
                }
              }}
            >
              <label>
                <span>Authentication code</span>
                <input
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={32}
                  name="code"
                  placeholder="123456"
                  required
                  spellCheck={false}
                />
              </label>
              <button className="auth-submit" type="submit">
                Verify and sign in
              </button>
            </form>
            <p className="auth-mode-switch">
              Not you? <Link href="/sign-in">Start over</Link>
            </p>
          </>
        ) : (
          <>
            <h1>This sign-in expired.</h1>
            <p>
              For your security, the code step lasts 10 minutes. Sign in again
              to get a new one.
            </p>
            <Link className="auth-submit" href="/sign-in">
              Sign in again
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
