"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

import { Gen2ChatPanel } from "./chat-panel";
import { Gen2Workbench, type Gen2WorkbenchHandle } from "./workbench";

const STATUS_LABEL: Record<Gen2WorkspaceDetail["status"], string> = {
  pending: "Not started",
  provisioning: "Starting",
  ready: "Running",
  failed: "Failed",
  stopped: "Stopped",
};

const START_WAIT_MS = 280_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
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
  const [agentRunning, setAgentRunning] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const workbenchRef = useRef<Gen2WorkbenchHandle | null>(null);
  const isOwner = current.role === "owner";
  const ready = current.status === "ready";

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);
  const openFile = useCallback(
    (path: string) => workbenchRef.current?.openFile(path),
    [],
  );

  async function applyResponse(response: Response) {
    const payload = (await response.json().catch(() => ({}))) as {
      workspace?: Gen2WorkspaceDetail;
      inviteUrl?: string;
      error?: string;
    };
    if (payload.workspace) {
      setCurrent((value) => ({ ...value, ...payload.workspace }));
    }
    if (!response.ok) {
      setError(payload.error ?? "That action could not be completed.");
      setBusy(null);
      router.refresh();
      return;
    }
    if (payload.inviteUrl) setInviteUrl(payload.inviteUrl);
    setBusy(null);
    router.refresh();
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
    // Provisioning a Firecracker guest routinely outlives a single request,
    // so race the POST against a poll and take whichever answers first.
    const request = fetch(`/api/gen2/workspaces/${current.id}/instance`, {
      method: "POST",
      signal: AbortSignal.timeout(START_WAIT_MS),
    }).then(
      (response) => ({ type: "post" as const, response }),
      () => ({ type: "fail" as const }),
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
        refresh();
        return;
      }
      try {
        const snapshot = await fetch(`/api/gen2/workspaces/${current.id}`)
          .then((response) => response.json())
          .then(
            (payload) => payload.workspace as Gen2WorkspaceDetail | undefined,
          );
        if (snapshot) setCurrent(snapshot);
        if (snapshot?.status === "ready" || snapshot?.status === "failed") {
          setBusy(null);
          if (snapshot.lastError) setError(snapshot.lastError);
          refresh();
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

  async function stopInstance() {
    const previous = current;
    setBusy("stop");
    setError("");
    setCurrent((value) => ({ ...value, status: "stopped", sandboxId: null }));
    try {
      const response = await fetch(
        `/api/gen2/workspaces/${current.id}/instance`,
        { method: "DELETE" },
      );
      await applyResponse(response);
      if (!response.ok) setCurrent(previous);
    } catch {
      setCurrent(previous);
      setError("Couldn't reach CoDev. Try again.");
      setBusy(null);
    }
  }

  async function share() {
    setBusy("share");
    setError("");
    setCopied(false);
    try {
      await applyResponse(
        await fetch(`/api/gen2/workspaces/${current.id}/share`, {
          method: "POST",
        }),
      );
    } catch {
      setError("Couldn't reach CoDev. Try again.");
      setBusy(null);
    }
  }

  return (
    <div className="gen2-ws">
      <header className="gen2-ws-bar">
        <Link className="gen2-back" href="/gen2">
          Workspaces
        </Link>
        <h1 className="gen2-ws-name">{current.name}</h1>
        <p
          className={`gen2-status gen2-status-${current.status}`}
          role="status"
        >
          <span className="gen2-status-dot" aria-hidden="true" />
          {STATUS_LABEL[current.status]}
        </p>

        <ul className="gen2-ws-members" aria-label="People with access">
          {(current.members ?? []).map((member) => (
            <li key={member.userId} title={member.name || member.login}>
              <span aria-hidden="true">
                {(member.name || member.login).slice(0, 1).toUpperCase()}
              </span>
              <span className="gen2-visually-hidden">
                {member.name || member.login}
              </span>
            </li>
          ))}
        </ul>

        {isOwner ? (
          <>
            {ready || current.status === "provisioning" ? (
              <button
                type="button"
                className="secondary-button"
                disabled={busy !== null}
                onClick={() => void stopInstance()}
              >
                {busy === "stop" ? "Stopping…" : "Stop"}
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                disabled={busy !== null}
                onClick={() => void startInstance()}
              >
                {busy === "start" ? "Starting…" : "Start instance"}
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={busy !== null}
              onClick={() => void share()}
            >
              {busy === "share" ? "Creating…" : "Share"}
            </button>
          </>
        ) : (
          <p className="gen2-wb-hint">
            {ready
              ? "This Firecracker instance is running."
              : "Waiting for the owner to start the instance."}
          </p>
        )}
      </header>

      {(current.lastError ?? error) ? (
        <p className="gen2-wb-banner gen2-wb-banner-error" role="alert">
          {error || current.lastError}
        </p>
      ) : null}

      {busy === "start" || current.status === "provisioning" ? (
        <p className="gen2-wb-banner" role="status">
          Waking the Firecracker host. This can take about a minute.
        </p>
      ) : null}

      {inviteUrl ? (
        <div className="gen2-ws-invite">
          <input value={inviteUrl} readOnly aria-label="Invite link" />
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void navigator.clipboard.writeText(inviteUrl);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : null}

      <div className="gen2-ws-body">
        <Gen2ChatPanel
          workspace={current}
          onRunningChange={setAgentRunning}
          onFilesChanged={refresh}
          onOpenFile={openFile}
        />
        <Gen2Workbench
          workspaceId={current.id}
          ready={ready}
          agentRunning={agentRunning}
          refreshToken={refreshToken}
          onRefresh={refresh}
          handleRef={workbenchRef}
        />
      </div>
    </div>
  );
}
