"use client";

import {
  Bot,
  ChevronLeft,
  GitBranch,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AgentPanel } from "@/components/agent-panel";
import { ProfileMenu } from "@/components/profile-menu";
import { WorkspaceShareButton } from "@/components/workspace-share-button";
import type { WorkspaceIdeProps } from "@/components/workspace-ide-types";
import { theiaWorkspaceUrl } from "@/lib/theia";

export function TheiaWorkspaceIde({
  workspaceId,
  repository,
  branch,
  workspaceName,
  members,
  initialAgentSessions,
  initialStateEvents,
  runtimeStatus,
  canEdit,
  canMerge,
  canReview,
  canShare,
  isOwner,
  user,
  useClerkAuth = false,
}: WorkspaceIdeProps) {
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [theiaReady, setTheiaReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const receiveMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.source !== "codev-theia"
      ) {
        return;
      }
      if (event.data.type === "ready") setTheiaReady(true);
      if (event.data.type === "focus-agents") setAgentsOpen(true);
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, []);

  const repositoryName =
    repository.split("/").slice(-2).join("/") || workspaceName;
  const runtimeCopy =
    runtimeStatus === "ready"
      ? theiaReady
        ? "Workspace ready"
        : "Connecting editor"
      : runtimeStatus === "hibernated"
        ? "Waking workspace"
        : "Preparing workspace";

  return (
    <main
      className="theia-workspace-shell"
      aria-label="CoDev collaborative workspace"
    >
      <header className="theia-workspace-header">
        <div className="theia-workspace-identity">
          <Link
            href="/dashboard"
            className="theia-back-link"
            aria-label="Back to dashboard"
          >
            <ChevronLeft aria-hidden="true" />
          </Link>
          <span className="theia-codev-mark" aria-hidden="true">
            C
          </span>
          <div>
            <strong>{repositoryName}</strong>
            <span>
              <GitBranch aria-hidden="true" /> {branch}
            </span>
          </div>
        </div>
        <div className="theia-runtime-state" data-status={runtimeStatus}>
          <i aria-hidden="true" />
          {runtimeCopy}
        </div>
        <div className="theia-workspace-actions">
          <WorkspaceShareButton
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            members={members}
            canShare={canShare}
            isOwner={isOwner}
          />
          <button
            type="button"
            className={agentsOpen ? "active" : ""}
            onClick={() => setAgentsOpen((open) => !open)}
            aria-pressed={agentsOpen}
          >
            <Bot aria-hidden="true" /> Agents
            {agentsOpen ? (
              <PanelRightClose aria-hidden="true" />
            ) : (
              <PanelRightOpen aria-hidden="true" />
            )}
          </button>
          <ProfileMenu
            compact
            user={{
              name: user.name,
              githubLogin: user.login,
              image: user.image,
            }}
            returnTo={`/workspaces/${workspaceId}/ide`}
            useClerkAuth={useClerkAuth}
          />
        </div>
      </header>

      <div
        className={`theia-workspace-body${agentsOpen ? " agents-open" : ""}`}
      >
        <section
          className="theia-editor-stage"
          aria-label="Eclipse Theia editor"
        >
          {canEdit ? (
            <iframe
              ref={frame}
              title="CoDev Eclipse Theia workspace"
              src={theiaWorkspaceUrl(workspaceId)}
              allow="clipboard-read; clipboard-write"
            />
          ) : (
            <div className="theia-readonly-state">
              <GitBranch aria-hidden="true" />
              <strong>Review workspace</strong>
              <p>
                The editable IDE is available to owners and co-steer
                collaborators. Use the agent review tools for this workspace.
              </p>
            </div>
          )}
        </section>

        {agentsOpen ? (
          <aside className="theia-agent-stage" aria-label="CoDev agents">
            <AgentPanel
              workspaceId={workspaceId}
              canMerge={canMerge}
              canReview={canReview}
              canSteer={canEdit && Boolean(repository)}
              initialSessions={initialAgentSessions}
              initialStateEvents={initialStateEvents}
            />
          </aside>
        ) : null}
      </div>
    </main>
  );
}
