"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

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
  isOwner,
  canProvision,
  canResume = canProvision,
  defaultBranch,
}: {
  workspaceId: string;
  runtime: RuntimeSummary | null;
  isOwner: boolean;
  canProvision?: boolean;
  canResume?: boolean;
  defaultBranch: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const status = runtime?.status ?? "stopped";
  const autoResumeStarted = useRef(false);

  async function sync() {
    setSyncing(true);
    setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/sync`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const { sync: result } = (await response.json()) as {
        sync: { updated: boolean; baseSha: string };
      };
      setMessage(
        result.updated
          ? `Synced to ${defaultBranch} at ${result.baseSha.slice(0, 12)}. Start the sandbox to work on the latest code.`
          : `Already up to date with ${defaultBranch}.`,
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  const mutate = useCallback(
    async (method: "POST" | "DELETE") => {
      setBusy(true);
      setMessage(
        method === "POST"
          ? "Waking the AWS host and preparing your isolated microVM…"
          : "",
      );
      try {
        let response: Response | undefined;
        for (let attempt = 0; attempt < 90; attempt += 1) {
          response = await fetch(`/api/workspaces/${workspaceId}/sandbox`, {
            method,
          });
          if (method !== "POST" || response.status !== 202) {
            break;
          }
          setMessage(
            "The bare-metal AWS host is starting. Your microVM will be prepared automatically…",
          );
          await new Promise((resolve) => setTimeout(resolve, 10_000));
        }
        if (!response || response.status === 202) {
          throw new Error(
            "The AWS host is still starting. Try again in a few minutes.",
          );
        }
        if (!response.ok) {
          throw new Error(await readError(response));
        }
        setMessage("");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Request failed.");
      } finally {
        setBusy(false);
      }
    },
    [router, workspaceId],
  );

  useEffect(() => {
    if (status !== "hibernated" || !canResume || autoResumeStarted.current) {
      return;
    }
    autoResumeStarted.current = true;
    void mutate("POST");
  }, [canResume, mutate, status]);

  return (
    <section className="phase-note runtime-note">
      <span>Phase 3</span>
      <div>
        <strong>
          {status === "ready"
            ? "Firecracker sandbox ready."
            : status === "hibernated"
              ? "Workspace hibernated to durable storage."
              : "AWS sandbox runtime."}
        </strong>
        <p>
          {status === "ready"
            ? `Isolated microVM ${runtime?.sandboxId ?? ""} is running. The browser IDE is ready.`
            : status === "provisioning"
              ? "The repository is being prepared inside an isolated Firecracker microVM."
              : status === "hibernated"
                ? "Your files and conversation state are persisted. Resume to restore the isolated microVM."
                : status === "failed"
                  ? (runtime?.lastError ?? "Sandbox provisioning failed.")
                  : "Provision a disposable Firecracker microVM for this repository."}
        </p>
        {message ? <p className="error-copy">{message}</p> : null}
      </div>
      {isOwner ||
      (canProvision && status !== "ready") ||
      (canResume && status === "hibernated") ? (
        status === "ready" ? (
          <div className="runtime-actions">
            <Link
              className="primary-button"
              href={`/workspaces/${workspaceId}/ide`}
            >
              Open IDE
            </Link>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void mutate("DELETE")}
            >
              {busy ? "Stopping…" : "Stop sandbox"}
            </button>
          </div>
        ) : (
          <div className="runtime-actions">
            <button
              className="primary-button"
              type="button"
              disabled={busy || status === "provisioning"}
              onClick={() => void mutate("POST")}
            >
              {busy || status === "provisioning"
                ? "Waking host…"
                : status === "hibernated"
                  ? "Resume sandbox"
                  : "Start sandbox"}
            </button>
            {status === "stopped" ? (
              <button
                className="secondary-button"
                type="button"
                disabled={busy || syncing}
                onClick={() => void sync()}
              >
                {syncing ? "Syncing…" : `Sync to latest ${defaultBranch}`}
              </button>
            ) : null}
          </div>
        )
      ) : status === "ready" ? (
        <Link
          className="primary-button"
          href={`/workspaces/${workspaceId}/ide`}
        >
          Open IDE
        </Link>
      ) : (
        <span className="runtime-state">{status}</span>
      )}
    </section>
  );
}
