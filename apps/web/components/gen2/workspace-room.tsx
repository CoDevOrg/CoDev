"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Settings2, UsersRound } from "lucide-react";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

import { Gen2ChatPanel } from "./chat-panel";
import { Gen2Workbench, type Gen2WorkbenchHandle } from "./workbench";
import { Gen2WorkspaceAccessPanel } from "./workspace-access-panel";
import { Gen2ProviderSettingsPanel } from "./provider-settings-panel";

const STATUS_LABEL: Record<Gen2WorkspaceDetail["status"], string> = {
  pending: "Starting",
  provisioning: "Starting",
  ready: "Ready",
  failed: "Failed",
  stopped: "Starting",
};

export function Gen2WorkspaceRoom({
  workspace,
}: {
  workspace: Gen2WorkspaceDetail;
}) {
  const [current, setCurrent] = useState(workspace);
  const [accessOpen, setAccessOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const workbenchRef = useRef<Gen2WorkbenchHandle | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const ready = current.status === "ready";

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
    refresh();
    return true;
  }, [current.id, refresh]);

  const bootedRef = useRef(false);
  useEffect(() => {
    if (ready || bootedRef.current) return;
    bootedRef.current = true;
    void ensureRunning();
  }, [ready, ensureRunning]);

  return (
    <div className="gen2-ws">
      <header className="gen2-ws-bar">
        <Link className="gen2-ws-back" href="/gen2" aria-label="All workspaces">
          <ArrowLeft aria-hidden="true" size={15} />
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

        {/*
         * Codex is a participant in this room, not just a feature of the chat
         * panel, so it gets a presence indicator alongside the human members
         * regardless of whether the workbench or a turn has started yet.
         */}
        <div
          className="gen2-codex-presence"
          role="region"
          aria-label="Codex"
          data-active={agentRunning || undefined}
        >
          <span className="gen2-codex-presence-dot" aria-hidden="true" />
          Codex
        </div>

        <button
          type="button"
          className="gen2-wb-button"
          aria-controls="gen2-access-panel"
          aria-expanded={accessOpen}
          onClick={() => {
            setProvidersOpen(false);
            setAccessOpen((open) => !open);
          }}
        >
          <UsersRound aria-hidden="true" size={14} /> Members
        </button>
        <button
          ref={settingsButtonRef}
          type="button"
          className="gen2-wb-button"
          aria-controls="gen2-provider-settings-panel"
          aria-expanded={providersOpen}
          onClick={() => {
            setAccessOpen(false);
            setProvidersOpen((open) => !open);
          }}
        >
          <Settings2 aria-hidden="true" size={14} /> Settings
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

      {accessOpen ? (
        <Gen2WorkspaceAccessPanel
          onClose={() => setAccessOpen(false)}
          onWorkspaceChange={setCurrent}
          workspace={current}
        />
      ) : null}

      {providersOpen ? (
        <Gen2ProviderSettingsPanel
          chatId={activeChatId}
          canManageOwnConnection={current.capabilities["connection.manageOwn"]}
          capabilities={current.capabilities}
          members={current.members}
          workspaceId={current.id}
          onClose={() => {
            setProvidersOpen(false);
            settingsButtonRef.current?.focus();
          }}
        />
      ) : null}

      <div className="gen2-ws-body">
        <Gen2ChatPanel
          workspace={current}
          onRunningChange={setAgentRunning}
          onChatChange={setActiveChatId}
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
          handleRef={workbenchRef}
        />
      </div>
    </div>
  );
}
