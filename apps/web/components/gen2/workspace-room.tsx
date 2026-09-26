"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Link2 } from "lucide-react";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

import { Gen2ChatPanel } from "./chat-panel";
import { Gen2Workbench, type Gen2WorkbenchHandle } from "./workbench";

const STATUS_LABEL: Record<Gen2WorkspaceDetail["status"], string> = {
  pending: "Starting",
  provisioning: "Starting",
  ready: "Ready",
  failed: "Failed",
  stopped: "Starting",
  deleting: "Deleting",
};

export function Gen2WorkspaceRoom({
  workspace,
}: {
  workspace: Gen2WorkspaceDetail;
}) {
  const [current, setCurrent] = useState(workspace);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const workbenchRef = useRef<Gen2WorkbenchHandle | null>(null);
  const ready = current.status === "ready" && runtimeReady;
  const displayStatus =
    current.status === "ready" && !runtimeReady
      ? "provisioning"
      : current.status;

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);
  const openFile = useCallback(
    (path: string) => workbenchRef.current?.openFile(path),
    [],
  );

  /**
   * Opening a workspace is the intent to use it, so the machine comes up on
   * its own. There is no start button: the request is idempotent, the server
   * decides whether anything needs doing, and a second member opening the
   * same workspace joins the boot already in progress.
   */
  const ensureRunning = useCallback(async () => {
    setRuntimeReady(false);
    try {
      const response = await fetch(
        `/api/gen2/workspaces/${current.id}/instance`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        workspace?: Gen2WorkspaceDetail;
        error?: string;
      };
      if (payload.workspace) setCurrent(payload.workspace);
      if (!response.ok) {
        setCurrent((value) => ({
          ...value,
          lastError: payload.error ?? "The machine could not start.",
        }));
        return false;
      }
      setRuntimeReady(true);
      refresh();
      return true;
    } catch {
      setCurrent((value) => ({
        ...value,
        lastError: "The machine could not be reached. Try again.",
      }));
      return false;
    }
  }, [current.id, refresh]);

  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void ensureRunning();
  }, [ensureRunning]);

  async function share() {
    const response = await fetch(`/api/gen2/workspaces/${current.id}/share`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      inviteUrl?: string;
    };
    if (!payload.inviteUrl) return;
    setInviteUrl(payload.inviteUrl);
    await navigator.clipboard.writeText(payload.inviteUrl).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_500);
  }

  return (
    <div className="gen2-ws">
      <header className="gen2-ws-bar">
        <Link className="gen2-ws-back" href="/gen2" aria-label="All workspaces">
          <ArrowLeft aria-hidden="true" size={15} />
        </Link>
        <h1 className="gen2-ws-name">{current.name}</h1>
        <p className={`gen2-status gen2-status-${displayStatus}`} role="status">
          <span className="gen2-status-dot" aria-hidden="true" />
          {STATUS_LABEL[displayStatus]}
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

        <button
          type="button"
          className="gen2-wb-button"
          onClick={() => void share()}
        >
          {copied ? (
            <>
              <Check aria-hidden="true" size={13} /> Link copied
            </>
          ) : (
            <>
              <Link2 aria-hidden="true" size={13} /> Share
            </>
          )}
        </button>
      </header>

      {current.lastError ? (
        <p className="gen2-wb-banner gen2-wb-banner-error" role="alert">
          {current.lastError}{" "}
          <button
            type="button"
            className="gen2-ws-retry"
            onClick={() => {
              setCurrent((value) => ({ ...value, lastError: null }));
              void ensureRunning();
            }}
          >
            Try again
          </button>
        </p>
      ) : null}

      {inviteUrl ? (
        <div className="gen2-ws-invite">
          <input value={inviteUrl} readOnly aria-label="Invite link" />
        </div>
      ) : null}

      <div className="gen2-ws-body">
        <Gen2ChatPanel
          workspace={current}
          onRunningChange={setAgentRunning}
          onFilesChanged={refresh}
          onOpenFile={openFile}
          onNeedsMachine={ensureRunning}
        />
        <Gen2Workbench
          workspaceId={current.id}
          ready={ready}
          agentRunning={agentRunning}
          refreshToken={refreshToken}
          onRefresh={refresh}
          onResumeWorkspace={ensureRunning}
          handleRef={workbenchRef}
        />
      </div>
    </div>
  );
}
