"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CollaborationClientMessage,
  CollaborationPresenceEntry,
  CollaborationUser,
  Gen2WorkspaceMember,
} from "@codev/contracts";

import {
  type RealtimeListener,
  WorkspaceRealtimeContext,
  type WorkspaceRealtime,
} from "./use-workspace-realtime";
import {
  connectWorkspaceRealtime,
  type RealtimeStatus,
  type WorkspaceRealtimeConnection,
} from "./workspace-realtime-socket";

type Focus = Extract<CollaborationClientMessage, { type: "focus" }>;

/**
 * Owns the workspace tab's single collaboration socket: presence, the live
 * member list, pushed workspace events and every open shared document go
 * through it. The last focus is replayed after each reconnect.
 */
export function WorkspaceRealtimeProvider({
  workspaceId,
  currentUserId,
  initialMembers,
  children,
}: {
  workspaceId: string;
  currentUserId: string;
  initialMembers: Gen2WorkspaceMember[];
  children: ReactNode;
}) {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [generation, setGeneration] = useState(0);
  const [resyncToken, setResyncToken] = useState(0);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [me, setMe] = useState<CollaborationUser | null>(null);
  const [presence, setPresence] = useState<CollaborationPresenceEntry[]>([]);
  const [members, setMembers] = useState(initialMembers);
  const listeners = useRef(new Set<RealtimeListener>());
  const connection = useRef<WorkspaceRealtimeConnection | null>(null);
  const focus = useRef<Focus | null>(null);

  useEffect(() => {
    const socket = connectWorkspaceRealtime({
      workspaceId,
      worktreeId: () => focus.current?.worktreeId ?? "main",
      onStatus: setStatus,
      onWelcome: (welcome, reconnected) => {
        setConnectionId(welcome.connectionId);
        setMe(welcome.user);
        if (focus.current) socket.send(focus.current);
        setGeneration((value) => value + 1);
        if (reconnected) setResyncToken((value) => value + 1);
      },
      onMessage: (message) => {
        if (message.type === "presence") setPresence(message.members);
        if (
          message.type === "event" &&
          message.event.kind === "members.changed"
        )
          setMembers(message.event.members);
        for (const listener of listeners.current) listener(message);
      },
    });
    connection.current = socket;
    return () => {
      connection.current = null;
      socket.close();
    };
  }, [workspaceId]);

  const send = useCallback((message: CollaborationClientMessage) => {
    if (message.type === "focus") focus.current = message;
    connection.current?.send(message);
  }, []);
  const listen = useCallback((listener: RealtimeListener) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);

  const value = useMemo<WorkspaceRealtime>(
    () => ({
      enabled: true,
      status,
      generation,
      resyncToken,
      connectionId,
      currentUserId,
      me,
      presence,
      members,
      send,
      listen,
    }),
    [
      status,
      generation,
      resyncToken,
      connectionId,
      currentUserId,
      me,
      presence,
      members,
      send,
      listen,
    ],
  );
  return (
    <WorkspaceRealtimeContext.Provider value={value}>
      {children}
    </WorkspaceRealtimeContext.Provider>
  );
}
