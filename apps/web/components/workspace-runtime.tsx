"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface RuntimeSummary {
  status:
    | "provisioning"
    | "ready"
    | "hibernated"
    | "stopping"
    | "stopped"
    | "failed";
  sandboxId: string | null;
  lastError: string | null;
}

async function readError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error ?? `Request failed with HTTP ${response.status}.`;
}

export function WorkspaceRuntime({
  workspaceId,
  runtime,
  canStartRuntime = false,
  hasRepository = true,
}: {
  workspaceId: string;
  runtime: RuntimeSummary | null;
  canStartRuntime?: boolean;
  hasRepository?: boolean;
}) {
  const status = runtime?.status ?? "stopped";
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  const startAttempted = useRef(false);

  const startWorkspace = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setMessage("Starting your workspace…");
    try {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const response = await fetch(`/api/workspaces/${workspaceId}/sandbox`, {
          method: "POST",
        });
        if (response.status !== 202) {
          if (!response.ok) throw new Error(await readError(response));
          window.location.reload();
          return;
        }
        setMessage("Preparing your workspace in the background…");
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw new Error("The workspace is still starting. Try again shortly.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Workspace startup failed.",
      );
    } finally {
      setStarting(false);
    }
  }, [starting, workspaceId]);

  useEffect(() => {
    if (
      !hasRepository ||
      !canStartRuntime ||
      status === "ready" ||
      status === "provisioning" ||
      status === "stopping" ||
      startAttempted.current
    ) {
      return;
    }
    startAttempted.current = true;
    void startWorkspace();
  }, [canStartRuntime, hasRepository, startWorkspace, status]);

  const isStarting = status === "provisioning" || status === "stopping";
  const isRestoring = status === "hibernated";

  return (
    <section className="phase-note runtime-note" aria-live="polite">
      <span>Workspace</span>
      <div>
        <strong>
          {!hasRepository
            ? "Workspace ready for a repository."
            : status === "ready"
              ? "Workspace is ready."
              : isRestoring
                ? "Restoring workspace."
                : status === "failed"
                  ? "Workspace needs attention."
                  : "Starting workspace."}
        </strong>
        <p>
          {!hasRepository
            ? "Connect a GitHub repository to enable live coding."
            : status === "ready"
              ? "Your files, conversations, and agent history are available."
              : isRestoring
                ? "Your saved workspace state is being restored in the background."
                : status === "failed"
                  ? (runtime?.lastError ?? "Workspace startup failed.")
                  : "Your workspace state is ready while compute starts in the background."}
        </p>
        {message ? <p className="error-copy">{message}</p> : null}
      </div>
      {hasRepository ? (
        <span className="runtime-state">
          {isStarting
            ? "Starting…"
            : isRestoring
              ? "Restoring…"
              : starting
                ? "Preparing…"
                : status === "ready"
                  ? "Active"
                  : status}
        </span>
      ) : null}
    </section>
  );
}
