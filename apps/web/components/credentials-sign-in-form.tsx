"use client";

import Link from "next/link";
import { useState } from "react";

import type { CredentialsIntent } from "@/lib/credentials-auth";
import { getNewAccountPasswordRequirements } from "@/lib/password-policy";

type CredentialsSignInFormProps = Readonly<{
  action: (formData: FormData) => void | Promise<void>;
  initialMode?: CredentialsIntent;
}>;

export function CredentialsSignInForm({
  action,
  initialMode = "sign-in",
}: CredentialsSignInFormProps) {
  const [mode, setMode] = useState<CredentialsIntent>(initialMode);
  const [password, setPassword] = useState("");
  const creatingAccount = mode === "sign-up";
  const requirements = getNewAccountPasswordRequirements(password);

  return (
    <form className="auth-credentials-form" action={action}>
      <input name="intent" type="hidden" value={mode} />
      {creatingAccount ? (
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
      ) : null}
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
          autoComplete={creatingAccount ? "new-password" : "current-password"}
          placeholder="Your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      {creatingAccount ? null : (
        <p className="auth-forgot-password">
          <Link href="/forgot-password">Forgot password?</Link>
        </p>
      )}
      {creatingAccount ? (
        <div className="auth-password-guidance" aria-live="polite">
          <p>New accounts need:</p>
          <ul aria-label="New account password requirements">
            {requirements.map((requirement) => (
              <li
                className={requirement.met ? "met" : "unmet"}
                key={requirement.id}
              >
                <span aria-hidden="true">{requirement.met ? "✓" : "○"}</span>
                {requirement.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <button className="auth-submit" type="submit">
        {creatingAccount ? "Create account" : "Sign in with email"}
      </button>
      <p className="auth-mode-switch">
        {creatingAccount ? (
          <>
            Already have an account?{" "}
            <button type="button" onClick={() => setMode("sign-in")}>
              Sign in
            </button>
          </>
        ) : (
          <>
            New to CoDev?{" "}
            <button type="button" onClick={() => setMode("sign-up")}>
              Create an account
            </button>
          </>
        )}
      </p>
    </form>
  );
}
