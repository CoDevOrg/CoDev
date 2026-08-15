import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/app-chrome";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { openPasswordResetToken } from "@/lib/password-reset";

export const metadata: Metadata = {
  title: "Reset password",
};

export const dynamic = "force-dynamic";

const errorCopy: Record<string, string> = {
  invalid: "This reset link is invalid or has expired. Request a new one.",
  match: "Those passwords did not match. Try again.",
  policy: "Choose a stronger password that meets every requirement below.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const state = token ? openPasswordResetToken(token) : null;
  const usableToken = error === "invalid" ? null : state ? token : null;

  return (
    <main className="auth-page">
      <div className="auth-nav">
        <Brand />
        <Link href="/sign-in">Sign in</Link>
      </div>
      <section className="auth-card">
        <p className="eyebrow">Password reset</p>
        {usableToken ? (
          <>
            <h1>Choose a new password.</h1>
            <p>Pick a new password for your CoDev account, then sign in.</p>
            {error && errorCopy[error] ? (
              <div className="inline-alert error" role="alert">
                {errorCopy[error]}
              </div>
            ) : null}
            <ResetPasswordForm token={usableToken} />
          </>
        ) : (
          <>
            <h1>This reset link is not valid.</h1>
            <p>
              {errorCopy.invalid} You can request another link from the sign-in
              page.
            </p>
            <Link className="auth-submit" href="/forgot-password">
              Forgot password
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
