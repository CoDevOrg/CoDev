"use client";

import { useEffect, useRef, useState } from "react";

import { buildOrcaIframeSource } from "@/components/orca-workspace";
import {
  EMPTY_CODEV_PARENT_BRIDGE_SESSION,
  executePersonalCodevBridgeRequest,
  isCodevBridgeClientMessage,
  isCodevBridgeRequestMessage,
  replyToCodevBridgeMessage,
  type CodevParentBridgeSession,
} from "@/components/codev-parent-bridge";

const HOST_STARTING_RETRY_MS = 8_000;

type ConnectionPhase =
  | { phase: "connecting" }
  | { phase: "host-starting" }
  | { phase: "ready"; iframeSrc: string }
  | { phase: "error"; message: string };

type PersonalOrcaResponse = {
  state?: string;
  pairingCode?: string;
  webClientPath?: string;
  workspacePath?: string | null;
  error?: string;
};

/**
 * Personal settings, rendered by the same Orca client the workspace uses.
 * It pairs with the member's own no-repo runtime and boots straight into
 * Settings, so the settings a person owns look and behave identically
 * whether or not they have a workspace open.
 */
export function PersonalSettingsSurface() {
  const [connection, setConnection] = useState<ConnectionPhase>({
    phase: "connecting",
  });
  const [attempt, setAttempt] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeSessionRef = useRef<CodevParentBridgeSession>(
    EMPTY_CODEV_PARENT_BRIDGE_SESSION,
  );

  useEffect(() => {
    function receiveMessage(event: MessageEvent<unknown>) {
      if (
        event.origin !== window.location.origin ||
        event.source !== iframeRef.current?.contentWindow ||
        !event.data ||
        typeof event.data !== "object"
      ) {
        return;
      }
      if (isCodevBridgeClientMessage(event.data)) {
        const { session, reply } = replyToCodevBridgeMessage(
          bridgeSessionRef.current,
          event.data,
        );
        bridgeSessionRef.current = session;
        if (reply) {
          iframeRef.current?.contentWindow?.postMessage(
            reply,
            window.location.origin,
          );
        }
        return;
      }
      if (isCodevBridgeRequestMessage(event.data)) {
        void executePersonalCodevBridgeRequest(
          event.data,
          bridgeSessionRef.current,
        ).then((reply) => {
          iframeRef.current?.contentWindow?.postMessage(
            reply,
            window.location.origin,
          );
        });
      }
    }

    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      try {
        const response = await fetch("/api/personal/orca", { method: "POST" });
        const payload = (await response
          .json()
          .catch(() => null)) as PersonalOrcaResponse | null;
        if (cancelled) return;

        if (response.status === 202) {
          setConnection({ phase: "host-starting" });
          retryTimer = setTimeout(() => {
            setAttempt((current) => current + 1);
          }, HOST_STARTING_RETRY_MS);
          return;
        }
        if (
          !response.ok ||
          !payload?.pairingCode ||
          !payload.webClientPath ||
          !payload.workspacePath
        ) {
          setConnection({
            phase: "error",
            message: payload?.error || "Personal settings could not be opened.",
          });
          return;
        }

        setConnection({
          phase: "ready",
          iframeSrc: buildOrcaIframeSource({
            webClientPath: payload.webClientPath,
            pairingCode: payload.pairingCode,
            workspacePath: payload.workspacePath,
            projectKind: "folder",
            settingsOnly: true,
          }),
        });
      } catch {
        if (!cancelled) {
          setConnection({
            phase: "error",
            message: "Personal settings could not be opened.",
          });
        }
      }
    }

    void connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [attempt]);

  if (connection.phase === "ready") {
    return (
      <div className="workspace-iframe-wrap">
        <iframe
          ref={iframeRef}
          className="workspace-iframe"
          src={connection.iframeSrc}
          title="CoDev settings"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    );
  }

  return (
    <main className="workspace-status">
      {connection.phase === "error" ? (
        <>
          <h1>Settings unavailable</h1>
          <p>{connection.message}</p>
          <button
            className="secondary-button"
            onClick={() => {
              setConnection({ phase: "connecting" });
              setAttempt((current) => current + 1);
            }}
            type="button"
          >
            Try again
          </button>
        </>
      ) : (
        <>
          <span className="workspace-iframe-loading-spinner" />
          <p>
            {connection.phase === "host-starting"
              ? "Starting your settings environment…"
              : "Opening your settings…"}
          </p>
        </>
      )}
    </main>
  );
}
