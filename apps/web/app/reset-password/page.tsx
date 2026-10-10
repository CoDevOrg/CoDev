import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/shell/app-chrome";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { describePasswordLink } from "@/lib/auth/password-link";

export const metadata: Metadata = {
  title: "Reset password",
  // The token is in this page's URL; never send it to another site.
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const link =
    token && error !== "invalid" ? await describePasswordLink(token) : null;

  return (
    <main className="auth-page">
      <div className="auth-nav">
        <Brand />
        <Link href="/sign-in">Sign in</Link>
      </div>
      <section className="auth-card">
        <p className="eyebrow">Password</p>
        {token && link ? (
          <>
            <h1>
              {link.hasPassword
                ? "Choose a new password."
                : "Create a password."}
            </h1>
            <p>
              {link.hasPassword
                ? "Pick a new password for your CoDev account."
                : "Add a password so you can also sign in with your email."}{" "}
              Saving it signs you out on every device, then you sign in again.
            </p>
            <ResetPasswordForm requiresCode={link.requiresCode} token={token} />
          </>
        ) : (
          <>
            <h1>This link is not valid.</h1>
            <p>
              Password links expire after one hour and stop working once used or
              once your password changes. Request a new one.
            </p>
            <Link className="auth-submit" href="/forgot-password">
              Get a new link
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
