"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  collaborationServerMessageSchema,
  type CollaborationPresenceEntry,
} from "@codev/contracts";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";

const REMOTE_ORIGIN = "codev-remote";

function encodeBase64(bytes: Uint8Array) {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(value);
}

function decodeBase64(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function socketUrl(workspaceId: string) {
  const url = new URL(
    `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/collaboration`,
    window.location.href,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export type Gen2DocumentConnectionState =
  | "idle"
  | "connecting"
  | "syncing"
  | "connected"
  | "disconnected"
  | "conflict";

/**
 * Browser-safe CoDev adapter for one open Gen 2 file. Superset's shared-file
 * interaction model stays above this hook; all desktop host and store
 * dependencies stop here.
 */
export function useGen2SharedFileDocument(input: {
  workspaceId: string;
  worktreeId: string;
  path: string | null;
  canEdit: boolean;
  onContentsChange: (contents: string) => void;
}) {
  const [text, setText] = useState<Y.Text | null>(null);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [state, setState] = useState<Gen2DocumentConnectionState>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [members, setMembers] = useState<CollaborationPresenceEntry[]>([]);
  const onContentsChangeRef = useRef(input.onContentsChange);
  const socketRef = useRef<WebSocket | null>(null);
  const syncedRef = useRef(false);

  useEffect(() => {
    onContentsChangeRef.current = input.onContentsChange;
  }, [input.onContentsChange]);

  // This effect creates the Yjs resource keyed by the selected file, so its
  // initial state must publish the newly created external resource handle.
  // Subsequent state changes come from socket/document callbacks.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!input.path) {
      setText(null);
      setAwareness(null);
      setState("idle");
      setNotice(null);
      setMembers([]);
      return;
    }

    let disposed = false;
    let reconnectTimer: number | null = null;
    const doc = new Y.Doc();
    const nextText = doc.getText("content");
    const nextAwareness = new Awareness(doc);
    const path = input.path;
    const worktreeId = input.worktreeId;
    syncedRef.current = false;
    setText(nextText);
    setAwareness(nextAwareness);
    setState("connecting");
    setNotice(null);
    setMembers([]);

    const send = (message: unknown) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(message));
    };
    const onDocumentUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN || !syncedRef.current) return;
      send({ type: "update", path, update: encodeBase64(update) });
    };
    const onTextChange = () => onContentsChangeRef.current(nextText.toString());
    const onAwarenessUpdate = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === REMOTE_ORIGIN || !syncedRef.current) return;
      const clients = [
        ...changes.added,
        ...changes.updated,
        ...changes.removed,
      ];
      if (clients.length > 0) {
        send({
          type: "awareness",
          path,
          update: encodeBase64(encodeAwarenessUpdate(nextAwareness, clients)),
        });
      }
    };
    doc.on("update", onDocumentUpdate);
    nextText.observe(onTextChange);
    nextAwareness.on("update", onAwarenessUpdate);

    const connect = () => {
      if (disposed) return;
      setState(syncedRef.current ? "syncing" : "connecting");
      const socket = new WebSocket(socketUrl(input.workspaceId));
      socketRef.current = socket;
      socket.onopen = () => send({ type: "join", worktreeId });
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = collaborationServerMessageSchema.safeParse(payload);
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === "welcome") {
          setState("syncing");
          send({ type: "subscribe", path });
        } else if (message.type === "sync" && message.path === path) {
          Y.applyUpdate(doc, decodeBase64(message.update), REMOTE_ORIGIN);
          syncedRef.current = true;
          setState("connected");
          setNotice(null);
        } else if (
          message.type === "update" &&
          message.worktreeId === worktreeId &&
          message.path === path
        ) {
          Y.applyUpdate(doc, decodeBase64(message.update), REMOTE_ORIGIN);
        } else if (
          message.type === "awareness" &&
          message.worktreeId === worktreeId &&
          message.path === path
        ) {
          applyAwarenessUpdate(
            nextAwareness,
            decodeBase64(message.update),
            REMOTE_ORIGIN,
          );
        } else if (message.type === "presence") {
          setMembers(
            message.members.filter(
              (member) =>
                member.worktreeId === worktreeId && member.path === path,
            ),
          );
        } else if (
          message.type === "reconciled" &&
          message.worktreeId === worktreeId &&
          message.path === path
        ) {
          if (message.update) {
            Y.applyUpdate(doc, decodeBase64(message.update), REMOTE_ORIGIN);
          }
          setNotice("An agent updated this file from the workspace.");
        } else if (
          message.type === "conflict" &&
          message.worktreeId === worktreeId &&
          message.path === path
        ) {
          setState("conflict");
          setNotice(message.message);
        } else if (
          message.type === "error" &&
          (!message.path || message.path === path)
        ) {
          setNotice(message.message);
          if (message.code === "conflict") setState("conflict");
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (disposed) return;
        setState("disconnected");
        setNotice("Collaboration disconnected. Reconnecting…");
        reconnectTimer = window.setTimeout(connect, 1_000);
      };
    };
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
      doc.off("update", onDocumentUpdate);
      nextText.unobserve(onTextChange);
      nextAwareness.off("update", onAwarenessUpdate);
      nextAwareness.destroy();
      doc.destroy();
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [input.workspaceId, input.worktreeId, input.path]);

  const updateCursor = useCallback(
    (cursor: { anchor: number; head: number } | null) => {
      if (!awareness) return;
      awareness.setLocalStateField("cursor", cursor);
    },
    [awareness],
  );

  return {
    text,
    awareness,
    state,
    notice,
    members,
    updateCursor,
    readOnly: !input.canEdit || state !== "connected",
  };
}
