"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import Image from "next/image";
import type { TeamRoster } from "@codev/contracts";
import { fetchTeamRoster } from "@/lib/team-chat-client";

const PRESENCE_REFRESH_MS = 15_000;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function memberName(member: TeamRoster["members"][number]) {
  return member.user.name?.trim() || member.user.login;
}

export function WorkspacePresenceMenu({
  workspaceId,
  activeAgentCount,
  onOpenTeamRoom,
}: {
  workspaceId: string;
  activeAgentCount: number | null;
  onOpenTeamRoom: () => void;
}) {
  const [roster, setRoster] = useState<TeamRoster | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setRoster(await fetchTeamRoster(workspaceId, signal));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible")
        void refresh(controller.signal);
    };
    refreshIfVisible();
    const timer = window.setInterval(refreshIfVisible, PRESENCE_REFRESH_MS);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popoverRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const members = roster?.members ?? [];
  const onlineMembers = members.filter((member) => member.online);
  const agentCount = activeAgentCount ?? roster?.agents.length ?? 0;

  return (
    <div className="workspace-presence">
      <button
        ref={triggerRef}
        type="button"
        className="workspace-presence-trigger"
        aria-label={`${onlineMembers.length} people here, ${agentCount} active agent sessions`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workspace-avatar-stack" aria-hidden="true">
          {onlineMembers.slice(0, 4).map((member) => (
            <span className="workspace-avatar" key={member.user.id}>
              {member.user.avatarUrl ? (
                <Image
                  src={member.user.avatarUrl}
                  alt=""
                  width={25}
                  height={25}
                  unoptimized
                />
              ) : (
                initials(memberName(member))
              )}
            </span>
          ))}
          {onlineMembers.length === 0 ? <Users size={14} /> : null}
        </span>
        <span className="workspace-presence-count">{onlineMembers.length}</span>
      </button>
      {open ? (
        <div
          ref={popoverRef}
          className="workspace-presence-popover"
          role="dialog"
          aria-label="People in this workspace"
        >
          <div className="workspace-presence-heading">
            <div>
              <strong>People</strong>
              <span>{onlineMembers.length} online</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenTeamRoom();
              }}
            >
              Open Team room
            </button>
          </div>
          <ul className="workspace-presence-list">
            {members.map((member) => (
              <li key={member.user.id}>
                <span className="workspace-avatar" aria-hidden="true">
                  {member.user.avatarUrl ? (
                    <Image
                      src={member.user.avatarUrl}
                      alt=""
                      width={25}
                      height={25}
                      unoptimized
                    />
                  ) : (
                    initials(memberName(member))
                  )}
                </span>
                <span className="workspace-presence-person">
                  <strong>{memberName(member)}</strong>
                  <span>
                    {member.isViewer ? "You · " : ""}
                    {member.headline ||
                      member.agentTask ||
                      member.activePath ||
                      member.accessRole.replaceAll("_", " ")}
                  </span>
                </span>
                <span className={member.online ? "is-online" : ""}>
                  {member.online ? "Online" : "Away"}
                </span>
              </li>
            ))}
          </ul>
          <div className="workspace-presence-agents">
            <strong>Agent sessions</strong>
            <span>{agentCount} active</span>
          </div>
          {roster?.agents.map((agent) => (
            <div className="workspace-presence-agent" key={agent.sessionId}>
              <span>{agent.name}</span>
              <span>{agent.currentTask || agent.status}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
