"use client";
import { useState } from "react";
import { signOut } from "next-auth/react";

export function useAccountDeletion() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/settings/account", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method === "DELETE"
          ? { body: JSON.stringify({ token: token.trim(), confirmation }) }
          : {}),
      });
      const result = await response.json();
      if (!response.ok) {
        const message =
          result &&
          typeof result === "object" &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "Please try again.";
        throw new Error(message);
      }
      if (method === "POST") setSent(true);
      else {
        await signOut({ redirect: false }).catch(() => undefined);
        window.location.assign("/sign-in?deleted=1");
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not reach CoDev.",
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    open,
    setOpen,
    sent,
    token,
    setToken,
    confirmation,
    setConfirmation,
    busy,
    error,
    submit,
  };
}
