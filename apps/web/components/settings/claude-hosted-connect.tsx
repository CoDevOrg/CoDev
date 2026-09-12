"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

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
const POLL_TIMEOUT_MS = 3 * 60 * 1_000;

/**
 * Best-effort teardown of a hosted session on the server. Used when the member
 * abandons the flow (cancel, retry, or navigating away) so an in-flight
 * `claude setup-token` run doesn't linger until it expires. `keepalive` lets it
 * survive the page unload that fires it.
 */
function deleteSession(id: string) {
  void fetch(`${BASE}/${id}`, { method: "DELETE", keepalive: true }).catch(
    () => {},
  );
}

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
  const [submitting, setSubmitting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const attempt = useRef(0);
  const sessionRef = useRef<SessionView | null>(null);
  const notifyConnected = useEffectEvent(onConnected);
  const activeSessionId =
    !connected && (phase === "awaiting_code" || phase === "polling")
      ? session?.id
      : undefined;

  // Mirror the latest session into a ref so the unmount cleanup can reach it
  // without re-running (and tearing the session down) on every session change.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(
    () => () => {
      attempt.current += 1;
      if (sessionRef.current) deleteSession(sessionRef.current.id);
    },
    [],
  );

  useEffect(() => {
    if (!activeSessionId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    async function poll() {
      try {
        const response = await fetch(`${BASE}/${activeSessionId}`, {
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as
          | SessionView
          | { error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok || !("status" in payload)) {
          throw new Error(
            ("error" in payload && payload.error) ||
              "Lost the connection attempt.",
          );
        }
        if (payload.status === "connected") {
          attempt.current += 1;
          setSession(null);
          setCode("");
          setError("");
          setSubmitting(false);
          setPhase("idle");
          notifyConnected();
          return;
        }
        if (payload.status === "failed") {
          throw new Error(
            payload.failureReason ?? "The connection attempt failed.",
          );
        }
        if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
          attempt.current += 1;
          deleteSession(activeSessionId);
          setSubmitting(false);
          setPhase("failed");
          setError("Timed out waiting for Claude. Start again.");
          return;
        }
        if (payload.status === "exchanging") setPhase("polling");
        // One request at a time. The server owns the session expiry, including
        // time spent authorizing in a background tab.
        timer = setTimeout(() => void poll(), POLL_MS);
      } catch (error) {
        if (controller.signal.aborted) return;
        attempt.current += 1;
        setSubmitting(false);
        setPhase("failed");
        setError(
          error instanceof Error
            ? error.message
            : "Lost the connection attempt.",
        );
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [activeSessionId]);

  function reset() {
    attempt.current += 1;
    // Free the hosted session when the member cancels or retries; a connected
    // session is consumed server-side and never routes through here.
    if (session) deleteSession(session.id);
    setSession(null);
    setCode("");
    setError("");
    setSubmitting(false);
    setPhase("idle");
  }

  function cancel() {
    if (canceling) return;
    setCanceling(true);
    attempt.current += 1;
    if (session) deleteSession(session.id);
    setSession(null);
    setCode("");
    setError("");
    setSubmitting(false);
    setCanceling(false);
    setPhase("idle");
  }

  async function start() {
    const currentAttempt = ++attempt.current;
    setPhase("starting");
    setError("");
    try {
      const response = await fetch(BASE, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as
        | SessionView
        | { error?: string };
      if (attempt.current !== currentAttempt) return;
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
    } catch {
      if (attempt.current !== currentAttempt) return;
      setPhase("failed");
      setError("Could not reach CoDev. Check your connection and try again.");
    }
  }

  async function submit() {
    if (!session || !code.trim() || submitting) return;
    const currentAttempt = attempt.current;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${BASE}/${session.id}/code`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (attempt.current !== currentAttempt) return;
      if (!response.ok) {
        setError(payload.error ?? "That code was not accepted.");
        return;
      }
      setPhase("polling");
      setCode("");
    } catch {
      if (attempt.current !== currentAttempt) return;
      setError(
        "Could not submit the code. Check your connection and try again.",
      );
    } finally {
      if (attempt.current === currentAttempt) setSubmitting(false);
    }
  }

  if (connected) return null;

  if (phase === "idle") {
    return (
      <Button
        className="mt-4 min-h-11"
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
        <p className="text-xs text-muted-foreground" role="status">
          Starting…
        </p>
      ) : null}

      {phase === "awaiting_code" && session ? (
        <>
          <p className="text-xs text-muted-foreground">
            Approve access on the Claude tab. CoDev will connect automatically
            when authorization finishes. If Claude gives you a code, paste it
            below.
          </p>
          <a
            className="inline-flex min-h-11 items-center text-sm text-foreground underline focus-visible:outline-2 focus-visible:outline-ring"
            href={session.authorizeUrl ?? "#"}
            rel="noreferrer"
            target="_blank"
          >
            Reopen Claude authorization
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="claude-connect-code">
              Authorization code
            </label>
            <Input
              autoComplete="off"
              className="min-h-11 min-w-0 flex-1"
              id="claude-connect-code"
              onChange={(event) => setCode(event.target.value)}
              placeholder="Paste code"
              spellCheck={false}
              value={code}
            />
            <Button
              className="min-h-11"
              disabled={!code.trim() || submitting}
              onClick={() => void submit()}
              size="sm"
              type="button"
              variant="outline"
            >
              {submitting ? "Submitting…" : "Submit"}
            </Button>
            <Button
              aria-busy={canceling}
              className="min-h-11"
              disabled={canceling}
              onClick={cancel}
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
        <div
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2"
          role="status"
        >
          <p className="text-xs text-muted-foreground">
            Linking your Claude subscription… This usually takes a few seconds.
          </p>
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
      ) : null}

      {phase === "failed" ? (
        <div className="space-y-2">
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
          <Button
            className="min-h-11"
            onClick={reset}
            size="sm"
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      ) : null}

      {error && phase !== "failed" ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
