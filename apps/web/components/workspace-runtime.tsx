"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RuntimeSummary {
  status: "provisioning" | "ready" | "stopping" | "stopped" | "failed";
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
}: {
  workspaceId: string;
  runtime: RuntimeSummary | null;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const status = runtime?.status ?? "stopped";

  async function mutate(method: "POST" | "DELETE") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/sandbox`, {
        method,
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="phase-note runtime-note">
      <span>Phase 3</span>
      <div>
        <strong>
          {status === "ready"
            ? "Firecracker sandbox ready."
            : "AWS sandbox runtime."}
        </strong>
        <p>
          {status === "ready"
            ? `Isolated microVM ${runtime?.sandboxId ?? ""} is running. The browser IDE connects in Phase 4.`
            : status === "provisioning"
              ? "The repository is being prepared inside an isolated Firecracker microVM."
              : status === "failed"
                ? (runtime?.lastError ?? "Sandbox provisioning failed.")
                : "Provision a disposable Firecracker microVM for this repository."}
        </p>
        {message ? <p className="error-copy">{message}</p> : null}
      </div>
      {isOwner ? (
        status === "ready" ? (
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void mutate("DELETE")}
          >
            {busy ? "Stopping…" : "Stop sandbox"}
          </button>
        ) : (
          <button
            className="primary-button"
            type="button"
            disabled={busy || status === "provisioning"}
            onClick={() => void mutate("POST")}
          >
            {busy || status === "provisioning"
              ? "Provisioning…"
              : "Start sandbox"}
          </button>
        )
      ) : (
        <span className="runtime-state">{status}</span>
      )}
    </section>
  );
}
