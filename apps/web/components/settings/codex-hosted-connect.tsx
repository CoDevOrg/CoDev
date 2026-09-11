"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type Phase = "idle" | "starting" | "authorizing" | "polling" | "failed";

type DeviceSession = {
  verificationUrl: string;
  userCode: string;
  deviceAuthId: string;
  intervalMs: number;
};

const SESSION_URL = "/api/auth/oauth/codex/session";
const POLL_URL = "/api/auth/oauth/codex/poll";
const RETURN_TO = "/settings/personal/providers";

/**
 * The in-app "Connect ChatGPT" flow. Unlike Claude's paste-back login, OpenAI's
 * `codex login` uses a browser→localhost callback that a remote runtime can't
 * receive, so this drives OpenAI's device-code flow instead: start a session,
 * show the user code + verification page, and poll until ChatGPT is linked. The
 * server materializes the resulting tokens into the Codex `auth.json` the
 * `codex exec` runtime already consumes. No terminal, no API key.
 */
export function CodexHostedConnect({
  connected,
  onConnected,
}: {
  connected: boolean;
  onConnected: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [device, setDevice] = useState<DeviceSession | null>(null);
  const [error, setError] = useState("");
  const attempt = useRef(0);
  const notifyConnected = useEffectEvent(onConnected);
  const polling = !connected && phase === "polling" ? device : null;

  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!polling) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch(POLL_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            deviceAuthId: polling!.deviceAuthId,
            userCode: polling!.userCode,
          }),
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          status?: string;
          error?: string;
        };
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(payload.error ?? "The connection attempt failed.");
        }
        if (payload.status === "connected") {
          attempt.current += 1;
          setDevice(null);
          setError("");
          setPhase("idle");
          notifyConnected();
          return;
        }
        if (payload.status === "denied") {
          throw new Error("ChatGPT sign-in was cancelled.");
        }
        // Still pending. The server owns the device-code expiry; keep polling at
        // the interval OpenAI asked for.
        timer = setTimeout(() => void poll(), polling!.intervalMs);
      } catch (error) {
        if (controller.signal.aborted) return;
        attempt.current += 1;
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
  }, [polling]);

  function reset() {
    attempt.current += 1;
    setDevice(null);
    setError("");
    setPhase("idle");
  }

  async function start() {
    const currentAttempt = ++attempt.current;
    setPhase("starting");
    setError("");
    try {
      const response = await fetch(SESSION_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scopeType: "USER", returnTo: RETURN_TO }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        mode?: string;
        verificationUrl?: string;
        userCode?: string;
        deviceAuthId?: string;
        intervalSeconds?: number;
        error?: string;
      };
      if (attempt.current !== currentAttempt) return;
      if (
        !response.ok ||
        payload.mode !== "device_code" ||
        !payload.verificationUrl ||
        !payload.userCode ||
        !payload.deviceAuthId
      ) {
        setPhase("failed");
        setError(payload.error ?? "ChatGPT connect could not start.");
        return;
      }
      const session: DeviceSession = {
        verificationUrl: payload.verificationUrl,
        userCode: payload.userCode,
        deviceAuthId: payload.deviceAuthId,
        intervalMs: Math.max(payload.intervalSeconds ?? 5, 1) * 1_000,
      };
      setDevice(session);
      setPhase("polling");
      window.open(session.verificationUrl, "_blank", "noopener,noreferrer");
    } catch {
      if (attempt.current !== currentAttempt) return;
      setPhase("failed");
      setError("Could not reach CoDev. Check your connection and try again.");
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
        Connect ChatGPT
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

      {phase === "polling" && device ? (
        <>
          <p className="text-xs text-muted-foreground">
            Enter this code on the ChatGPT tab to approve access. CoDev connects
            automatically when authorization finishes.
          </p>
          <p className="text-center font-mono text-lg font-semibold tracking-[0.3em]">
            {device.userCode}
          </p>
          <a
            className="inline-flex min-h-11 items-center text-sm text-foreground underline focus-visible:outline-2 focus-visible:outline-ring"
            href={device.verificationUrl}
            rel="noreferrer"
            target="_blank"
          >
            Reopen ChatGPT authorization
          </a>
          <div>
            <Button
              className="min-h-11"
              onClick={reset}
              size="sm"
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
          </div>
        </>
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
    </div>
  );
}
