"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

import { Gen2AgentPanel } from "./agent-panel";

const STATUS_LABEL: Record<Gen2WorkspaceDetail["status"], string> = {
  pending: "Not started",
  provisioning: "Starting",
  ready: "Running",
  failed: "Failed",
  stopped: "Stopped",
};

const START_WAIT_MS = 280_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function Gen2WorkspaceRoom({
  workspace,
}: {
  workspace: Gen2WorkspaceDetail;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(workspace);
  const [busy, setBusy] = useState<"start" | "stop" | "share" | null>(null);
  const [error, setError] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const isOwner = current.role === "owner";

  useEffect(() => {
    setCurrent(workspace);
  }, [workspace]);

  async function applyResponse(response: Response) {
    const payload = (await response.json().catch(() => ({}))) as {
      workspace?: Gen2WorkspaceDetail;
      inviteUrl?: string;
      error?: string;
    };
    if (payload.workspace) {
      setCurrent((value) => ({
        ...value,
        ...payload.workspace,
        members: payload.workspace?.members ?? value.members,
      }));
    }
    if (!response.ok) {
      setError(payload.error ?? "That action could not be completed.");
      setBusy(null);
      router.refresh();
      return;
    }
    if (payload.inviteUrl) {
      setInviteUrl(payload.inviteUrl);
    }
    setBusy(null);
    router.refresh();
  }

  async function mutate(
    action: "start" | "stop" | "share",
    request: Promise<Response>,
  ) {
    setBusy(action);
    setError("");
    setCopied(false);
    try {
      await applyResponse(await request);
    } catch {
      setError("Couldn't reach CoDev. Try again.");
      setBusy(null);
    }
  }

  async function pollWorkspace() {
    const response = await fetch(`/api/gen2/workspaces/${current.id}`);
    const payload = (await response.json().catch(() => ({}))) as {
      workspace?: Gen2WorkspaceDetail;
    };
    if (payload.workspace) {
      setCurrent(payload.workspace);
      return payload.workspace;
    }
    return null;
  }

  async function startInstance() {
    setBusy("start");
    setError("");
    setCopied(false);
    setCurrent((value) => ({
      ...value,
      status: "provisioning",
      lastError: null,
    }));
    const request = fetch(`/api/gen2/workspaces/${current.id}/instance`, {
      method: "POST",
      signal: AbortSignal.timeout(START_WAIT_MS),
    }).then(
      (response) => ({ type: "post" as const, response }),
      (cause) => ({ type: "fail" as const, cause }),
    );
    const deadline = Date.now() + START_WAIT_MS;
    while (Date.now() < deadline) {
      const outcome = await Promise.race([
        request,
        sleep(2_000).then(() => ({ type: "tick" as const })),
      ]);
      if (outcome.type === "fail") {
        setError("Couldn't reach CoDev. Try again.");
        setBusy(null);
        router.refresh();
        return;
      }
      if (outcome.type === "post") {
        await applyResponse(outcome.response);
        return;
      }
      try {
        const snapshot = await pollWorkspace();
        if (
          snapshot &&
          (snapshot.status === "ready" ||
            snapshot.status === "failed" ||
            (snapshot.status !== "provisioning" && snapshot.lastError))
        ) {
          setBusy(null);
          if (snapshot.lastError) setError(snapshot.lastError);
          router.refresh();
          return;
        }
      } catch {
        /* The POST is still the source of truth. */
      }
    }
    setError("The instance is still starting. Refresh in a few seconds.");
    setBusy(null);
    router.refresh();
  }

  async function copyLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  }

  async function stopInstance() {
    const previous = current;
    setBusy("stop");
    setError("");
    setCopied(false);
    setCurrent((value) => ({
      ...value,
      status: "stopped",
      sandboxId: null,
      lastError: null,
    }));
    try {
      const response = await fetch(
        `/api/gen2/workspaces/${current.id}/instance`,
        { method: "DELETE" },
      );
      await applyResponse(response);
      if (!response.ok) {
        setCurrent(previous);
      }
    } catch {
      setCurrent(previous);
      setError("Couldn't reach CoDev. Try again.");
      setBusy(null);
    }
  }

  const starting = busy === "start" || current.status === "provisioning";

  return (
    <section className="gen2-room">
      <header className="gen2-room-header">
        <div>
          <p className="eyebrow">Gen 2 workspace</p>
          <h1>{current.name}</h1>
        </div>
        <p
          className={`gen2-status gen2-status-${current.status}`}
          role="status"
        >
          <span className="gen2-status-dot" aria-hidden="true" />
          {STATUS_LABEL[current.status]}
        </p>
      </header>

      {current.lastError ? (
        <p className="form-message error-copy" role="alert">
          {current.lastError}
        </p>
      ) : null}

      <div className="gen2-actions">
        {isOwner ? (
          busy === "stop" ? (
            <button className="secondary-button" type="button" disabled>
              Stopping…
            </button>
          ) : current.status === "ready" ||
            current.status === "provisioning" ? (
            busy === "start" ? (
              <button className="primary-button" type="button" disabled>
                Starting…
              </button>
            ) : (
              <button
                className="secondary-button"
                type="button"
                disabled={busy !== null}
                onClick={() => void stopInstance()}
              >
                Stop instance
              </button>
            )
          ) : (
            <button
              className="primary-button"
              type="button"
              disabled={busy !== null}
              onClick={() => void startInstance()}
            >
              Start instance
            </button>
          )
        ) : (
          <p className="gen2-note">
            {current.status === "ready"
              ? "This Firecracker instance is running."
              : "Waiting for the owner to start the instance."}
          </p>
        )}
        {isOwner ? (
          <button
            className="secondary-button"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void mutate(
                "share",
                fetch(`/api/gen2/workspaces/${current.id}/share`, {
                  method: "POST",
                }),
              )
            }
          >
            {busy === "share" ? "Creating link…" : "Share"}
          </button>
        ) : null}
      </div>

      {starting ? (
        <p className="gen2-note" role="status">
          Waking the Firecracker host. This can take about a minute.
        </p>
      ) : null}

      {inviteUrl ? (
        <div className="gen2-share">
          <label className="gen2-field">
            <span>Invite link</span>
            <input value={inviteUrl} readOnly aria-label="Invite link" />
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void copyLink()}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="form-message error-copy" role="alert">
          {error}
        </p>
      ) : null}

      <Gen2AgentPanel workspace={current} />

      <section className="gen2-members" aria-labelledby="gen2-members-heading">
        <h2 id="gen2-members-heading">People</h2>
        <ul>
          {(current.members ?? []).map((member) => (
            <li key={member.userId}>
              <strong>{member.name || member.login}</strong>
              <span>{member.role === "owner" ? "Owner" : "Member"}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
