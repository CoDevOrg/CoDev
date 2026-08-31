"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type ConnectState = "idle" | "starting" | "waiting" | "connected" | "error";

/**
 * Browser-login connect for Cursor, mirroring `cursor-agent login`: start a
 * session, open Cursor's deeplink in a new tab, then poll until CoDev has the
 * `{accessToken, refreshToken}` pair. No API key to paste.
 */
export function CursorConnectCard({
  connected,
  scopeType,
  workspaceId,
  returnTo,
}: {
  connected: boolean;
  scopeType: "USER" | "WORKSPACE";
  workspaceId?: string | undefined;
  returnTo: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<ConnectState>(
    connected ? "connected" : "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function poll() {
    const response = await fetch("/api/auth/oauth/cursor/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      status?: string;
      error?: string;
    };
    if (!response.ok) {
      stopPolling();
      setState("error");
      setMessage(payload.error ?? "Cursor sign-in failed. Start again.");
      return;
    }
    if (payload.status === "connected") {
      stopPolling();
      setState("connected");
      setMessage("Cursor is connected.");
      router.refresh();
      return;
    }
    if (payload.status === "denied") {
      stopPolling();
      setState("error");
      setMessage("Cursor sign-in was cancelled.");
    }
  }

  async function start() {
    setState("starting");
    setMessage(null);
    setLoginUrl(null);
    const response = await fetch("/api/auth/oauth/cursor/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnTo, scopeType, workspaceId }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      loginUrl?: string;
      error?: string;
    };
    if (!response.ok || !payload.loginUrl) {
      setState("error");
      setMessage(payload.error ?? "Cursor sign-in could not start.");
      return;
    }
    setLoginUrl(payload.loginUrl);
    window.open(payload.loginUrl, "_blank", "noopener,noreferrer");
    setState("waiting");
    stopPolling();
    void poll();
    pollTimer.current = setInterval(() => void poll(), 2000);
  }

  return (
    <div className="credential-form">
      <div className="credential-status">
        <span className={state === "connected" ? "dot-ready" : "dot-muted"} />
        <div>
          <strong>
            {state === "connected"
              ? "Cursor account connected"
              : "Not connected"}
          </strong>
          <small>
            Signs in through Cursor in the browser. The token is encrypted and
            handed to the workspace&rsquo;s <code>cursor-agent</code>.
          </small>
        </div>
      </div>
      {state === "waiting" ? (
        <p className="form-message">
          Finish signing in on the Cursor tab
          {loginUrl ? (
            <>
              {" "}
              (
              <a href={loginUrl} rel="noreferrer" target="_blank">
                reopen
              </a>
              )
            </>
          ) : null}
          . Keep this page open&hellip;
        </p>
      ) : null}
      <div className="form-actions">
        <button
          className="primary-button"
          type="button"
          disabled={state === "starting" || state === "waiting"}
          onClick={() => void start()}
        >
          {state === "starting"
            ? "Starting…"
            : state === "waiting"
              ? "Waiting for Cursor…"
              : state === "connected"
                ? "Reconnect"
                : "Connect with Cursor"}
        </button>
      </div>
      {message ? <p className="form-message">{message}</p> : null}
    </div>
  );
}
