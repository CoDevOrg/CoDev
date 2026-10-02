"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Starts a Stripe-hosted page: Checkout to subscribe, or the Customer Portal
 * to manage an existing plan. The server returns a URL; the browser leaves
 * for it. Nothing about the card ever touches CoDev.
 */
export function BillingButton({
  action,
  children,
  variant = "default",
  size = "default",
  className,
  fullWidth = false,
}: {
  action: "checkout" | "portal";
  children: React.ReactNode;
  variant?: "default" | "outline" | "secondary" | "solid";
  size?: "default" | "sm" | "lg";
  className?: string;
  fullWidth?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/billing/${action}`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !payload.url) {
        setError(
          payload.error ?? "Billing is unavailable right now. Try again.",
        );
        setBusy(false);
        return;
      }
      window.location.assign(payload.url);
    } catch {
      setError("Couldn't reach CoDev. Try again.");
      setBusy(false);
    }
  }

  return (
    <div
      className={`flex flex-col gap-2 ${fullWidth ? "items-stretch" : "items-start"}`}
    >
      <Button
        aria-busy={busy}
        className={className}
        disabled={busy}
        onClick={() => void go()}
        size={size}
        type="button"
        variant={variant}
      >
        {busy ? (
          <LoaderCircle
            aria-hidden
            className="size-4 motion-safe:animate-spin"
          />
        ) : null}
        {children}
      </Button>
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
