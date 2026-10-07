"use client";

import Link from "next/link";

type CredentialsSignInFormProps = Readonly<{
  action: (formData: FormData) => void | Promise<void>;
}>;

export function CredentialsSignInForm({ action }: CredentialsSignInFormProps) {
  return (
    <form className="auth-credentials-form" action={action}>
      <input name="intent" type="hidden" value="sign-in" />
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
          placeholder="Your password"
          required
        />
      </label>
      <p className="auth-forgot-password">
        <Link href="/forgot-password">Forgot password?</Link>
      </p>
      <button className="auth-submit" type="submit">
        Sign in with email
      </button>
    </form>
  );
}
