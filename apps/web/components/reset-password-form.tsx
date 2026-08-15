"use client";

import { useState } from "react";

import { completePasswordReset } from "@/app/actions/password-reset";
import { getNewAccountPasswordRequirements } from "@/lib/password-policy";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const requirements = getNewAccountPasswordRequirements(password);

  return (
    <form className="auth-credentials-form" action={completePasswordReset}>
      <input name="token" type="hidden" value={token} />
      <label>
        <span>New password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Your new password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <label>
        <span>Confirm password</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat your new password"
          required
        />
      </label>
      <div className="auth-password-guidance" aria-live="polite">
        <p>Your new password needs:</p>
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
        Save new password
      </button>
    </form>
  );
}
