import type { Metadata } from "next";
import Link from "next/link";

import { requestPasswordReset } from "@/app/actions/password-reset";
import { Brand } from "@/components/app-chrome";

export const metadata: Metadata = {
  title: "Forgot password",
};

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <main className="auth-page">
      <div className="auth-nav">
        <Brand />
        <Link href="/sign-in">Sign in</Link>
      </div>
      <section className="auth-card">
        <p className="eyebrow">Password reset</p>
        {sent ? (
          <>
            <h1>Check your email.</h1>
            <p>
              If that address has a CoDev password, we sent a reset link. It
              expires in one hour.
            </p>
            <Link className="auth-submit" href="/sign-in">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h1>Forgot your password?</h1>
            <p>
              Enter the email you use to sign in. If an account exists, we will
              send a reset link.
            </p>
            <form
              className="auth-credentials-form"
              action={requestPasswordReset}
            >
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
              <button className="auth-submit" type="submit">
                Send reset link
              </button>
            </form>
            <p className="auth-mode-switch">
              Remembered it? <Link href="/sign-in">Sign in</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
