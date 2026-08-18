"use client";

import { useState } from "react";

export function CliAuthorizationForm({
  initialCode = "",
}: {
  initialCode?: string;
}) {
  const [userCode, setUserCode] = useState(initialCode.toUpperCase());
  const [state, setState] = useState<"idle" | "busy" | "approved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function approve() {
    setState("busy");
    setMessage("");
    const response = await fetch("/api/cli/auth/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userCode }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setState("error");
      setMessage(payload.error ?? "The CLI could not be authorized.");
      return;
    }
    setState("approved");
    setMessage(
      "CoDev CLI authorized. You can close this tab and return to your terminal.",
    );
  }

  return (
    <div className="oauth-connection-flow">
      <label htmlFor="cli-user-code">One-time CLI code</label>
      <div className="oauth-connection-flow-row">
        <input
          autoCapitalize="characters"
          autoComplete="one-time-code"
          disabled={state === "approved"}
          id="cli-user-code"
          maxLength={9}
          onChange={(event) => setUserCode(event.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          value={userCode}
        />
        <button
          className="primary-button"
          disabled={
            state === "busy" || state === "approved" || userCode.length < 8
          }
          onClick={() => void approve()}
          type="button"
        >
          {state === "busy"
            ? "Authorizing…"
            : state === "approved"
              ? "Authorized"
              : "Authorize CLI"}
        </button>
      </div>
      {message ? (
        <div
          className={`oauth-connection-notice ${state === "approved" ? "is-success" : "is-warning"}`}
          role={state === "approved" ? "status" : "alert"}
        >
          {message}
        </div>
      ) : null}
      <p>
        Only approve a code shown by <code>codev login</code> in a terminal you
        control. This grants that CLI access to upload encrypted coding-agent
        credentials to your CoDev account.
      </p>
    </div>
  );
}
