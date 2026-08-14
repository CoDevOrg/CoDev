"use client";

import { useState } from "react";

import { getNewAccountPasswordRequirements } from "@/lib/password-policy";

type CredentialsSignInFormProps = Readonly<{
  action: (formData: FormData) => void | Promise<void>;
}>;

export function CredentialsSignInForm({ action }: CredentialsSignInFormProps) {
  const [password, setPassword] = useState("");
  const requirements = getNewAccountPasswordRequirements(password);

  return (
    <form className="auth-credentials-form" action={action}>
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
          placeholder="Your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
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
      <button className="auth-submit" type="submit">
        Continue with email
      </button>
    </form>
  );
}
