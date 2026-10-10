"use client";

import { useActionState, useEffect, useState } from "react";

import {
  completePasswordReset,
  type PasswordResetState,
} from "@/app/actions/password-reset";
import { getNewAccountPasswordRequirements } from "@/lib/auth/password-policy";

export function ResetPasswordForm({
  token,
  requiresCode,
}: {
  token: string;
  /** The account has 2FA: an emailed link alone must not replace its password. */
  requiresCode: boolean;
}) {
  const [password, setPassword] = useState("");
  const [state, action, pending] = useActionState<PasswordResetState, FormData>(
    completePasswordReset,
    { error: null },
  );
  const requirements = getNewAccountPasswordRequirements(password);

  // React clears the other fields after a failed submit; clear this one too
  // so the form never shows a half-filled state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPassword("");
  }, [state]);

  return (
    <form className="auth-credentials-form" action={action}>
      {state.error ? (
        <div className="inline-alert error" role="alert">
          {state.error}
        </div>
      ) : null}
      <input name="token" type="hidden" value={token} />
      <label>
        <span>New password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          maxLength={128}
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
          maxLength={128}
          placeholder="Repeat your new password"
          required
        />
      </label>
      {requiresCode ? (
        <label>
          <span>Authentication code</span>
          <input
            name="code"
            autoComplete="one-time-code"
            maxLength={32}
            placeholder="6-digit code or a recovery code"
            required
            spellCheck={false}
          />
        </label>
      ) : null}
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
        <p>It must also not appear in a known data breach.</p>
      </div>
      <button className="auth-submit" disabled={pending} type="submit">
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
