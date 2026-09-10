"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SessionView = {
  id: string;
  status: "starting" | "awaiting_code" | "exchanging" | "connected" | "failed";
  authorizeUrl: string | null;
  failureReason: string | null;
};

type Phase = "idle" | "starting" | "awaiting_code" | "polling" | "failed";

const BASE = "/api/personal/claude-connection/session";
const POLL_MS = 2_000;
const POLL_LIMIT = 90; // ~3 minutes

/**
 * The in-app "Connect Claude" flow: starts a hosted `claude setup-token` run,
 * opens Anthropic's authorization page, takes the code the member pastes back,
 * and polls until the subscription is linked. No terminal, no API key.
 */
export function ClaudeHostedConnect({
  connected,
  onConnected,
}: {
  connected: boolean;
  onConnected: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<SessionView | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [canceling, setCanceling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);

  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (session) {
        void fetch(`${BASE}/${session.id}`, {
          method: "DELETE",
          keepalive: true,
        });
      }
    },
    [session],
  );

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function reset() {
    stopPolling();
    setSession(null);
    setCode("");
    setError("");
    setCanceling(false);
    setPhase("idle");
  }

  async function cancel() {
    stopPolling();
    if (!session) {
      reset();
      return;
    }
    setCanceling(true);
    setError("");
    try {
      const response = await fetch(`${BASE}/${session.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not cancel this attempt.");
      }
      reset();
    } catch (cause) {
      setCanceling(false);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not cancel this attempt.",
      );
    }
  }

  async function start() {
    setPhase("starting");
    setError("");
    const response = await fetch(BASE, { method: "POST" });
    const payload = (await response.json().catch(() => ({}))) as
      | SessionView
      | { error?: string };
    if (!response.ok || !("id" in payload)) {
      setPhase("failed");
      setError(
        ("error" in payload && payload.error) ||
          "Claude connect could not start.",
      );
      return;
    }
    setSession(payload);
    setPhase("awaiting_code");
    if (payload.authorizeUrl) {
      window.open(payload.authorizeUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function submit() {
    if (!session || !code.trim()) return;
    setError("");
    const response = await fetch(`${BASE}/${session.id}/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) {
      setError(payload.error ?? "That code was not accepted.");
      return;
    }
    setPhase("polling");
    pollCount.current = 0;
    void poll();
    pollTimer.current = setInterval(() => void poll(), POLL_MS);
  }

  async function poll() {
    if (!session) return;
    pollCount.current += 1;
    const response = await fetch(`${BASE}/${session.id}`);
    const payload = (await response.json().catch(() => ({}))) as
      | SessionView
      | { error?: string };
    if (!response.ok || !("status" in payload)) {
      stopPolling();
      setPhase("failed");
      setError(
        ("error" in payload && payload.error) || "Lost the connection attempt.",
      );
      return;
    }
    if (payload.status === "connected") {
      stopPolling();
      reset();
      onConnected();
      return;
    }
    if (payload.status === "failed") {
      stopPolling();
      setPhase("failed");
      setError(payload.failureReason ?? "The connection attempt failed.");
      return;
    }
    if (pollCount.current >= POLL_LIMIT) {
      stopPolling();
      setPhase("failed");
      setError("Timed out waiting for Claude. Start again.");
      void fetch(`${BASE}/${session.id}`, {
        method: "DELETE",
        keepalive: true,
      });
    }
  }

  if (connected) return null;

  if (phase === "idle") {
    return (
      <Button
        className="mt-4"
        onClick={() => void start()}
        size="sm"
        type="button"
      >
        Connect Claude
      </Button>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-md border border-border bg-background/60 p-4">
      {phase === "starting" ? (
        <p className="text-xs text-muted-foreground">Starting…</p>
      ) : null}

      {phase === "awaiting_code" && session ? (
        <>
          <p className="text-xs text-muted-foreground">
            Approve access on the Claude tab (
            <a
              className="underline"
              href={session.authorizeUrl ?? "#"}
              rel="noreferrer"
              target="_blank"
            >
              reopen
            </a>
            ), then paste the code it gives you.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="claude-connect-code">
              Authorization code
            </label>
            <Input
              autoComplete="off"
              className="min-w-[12rem] flex-1"
              id="claude-connect-code"
              onChange={(event) => setCode(event.target.value)}
              placeholder="Paste code"
              spellCheck={false}
              value={code}
            />
            <Button
              disabled={!code.trim()}
              onClick={() => void submit()}
              size="sm"
              type="button"
              variant="outline"
            >
              Submit
            </Button>
            <Button
              aria-busy={canceling}
              disabled={canceling}
              onClick={() => void cancel()}
              size="sm"
              type="button"
              variant="secondary"
            >
              {canceling ? "Canceling…" : "Cancel"}
            </Button>
          </div>
        </>
      ) : null}

      {phase === "polling" ? (
        <p className="text-xs text-muted-foreground">
          Linking your Claude subscription…
        </p>
      ) : null}

      {phase === "failed" ? (
        <div className="space-y-2">
          <p className="text-xs text-destructive">{error}</p>
          <Button onClick={reset} size="sm" type="button" variant="outline">
            Try again
          </Button>
        </div>
      ) : null}

      {error && phase !== "failed" ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
