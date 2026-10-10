"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import type {
  CollaborationClientMessage,
  CollaborationPresenceEntry,
  CollaborationServerMessage,
  CollaborationUser,
  Gen2RealtimeEvent,
  Gen2RealtimeEventKind,
  Gen2WorkspaceMember,
} from "@codev/contracts";

import type { RealtimeStatus } from "./workspace-realtime-socket";

export type RealtimeListener = (message: CollaborationServerMessage) => void;

export interface WorkspaceRealtime {
  enabled: boolean;
  status: RealtimeStatus;
  /** Bumps on every welcome; subscriptions are re-sent when it changes. */
  generation: number;
  /** Bumps only on reconnects, when pushed state may have been missed. */
  resyncToken: number;
  connectionId: string | null;
  /** The signed-in member, known before the socket connects. */
  currentUserId: string | null;
  me: CollaborationUser | null;
  presence: CollaborationPresenceEntry[];
  members: Gen2WorkspaceMember[];
  send: (message: CollaborationClientMessage) => void;
  listen: (listener: RealtimeListener) => () => void;
}

const noop = () => undefined;

/** Outside a provider (tests, disabled runtime) nothing is live. */
export const WorkspaceRealtimeContext = createContext<WorkspaceRealtime>({
  enabled: false,
  status: "connecting",
  generation: 0,
  resyncToken: 0,
  connectionId: null,
  currentUserId: null,
  me: null,
  presence: [],
  members: [],
  send: noop,
  listen: () => noop,
});

export function useWorkspaceRealtime() {
  return useContext(WorkspaceRealtimeContext);
}

type EventOf<Kind extends Gen2RealtimeEventKind> = Extract<
  Gen2RealtimeEvent,
  { kind: Kind }
>;

/** Runs `handler` for each pushed workspace event of `kind`. */
export function useRealtimeEvent<Kind extends Gen2RealtimeEventKind>(
  kind: Kind,
  handler: (event: EventOf<Kind>) => void,
) {
  const { listen } = useWorkspaceRealtime();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(
    () =>
      listen((message) => {
        if (message.type === "event" && message.event.kind === kind)
          handlerRef.current(message.event as EventOf<Kind>);
      }),
    [kind, listen],
  );
}

/** Runs `handler` after a reconnect, when pushed events may have been missed. */
export function useRealtimeResync(handler: () => void) {
  const { resyncToken } = useWorkspaceRealtime();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(() => {
    if (resyncToken > 0) handlerRef.current();
  }, [resyncToken]);
}
