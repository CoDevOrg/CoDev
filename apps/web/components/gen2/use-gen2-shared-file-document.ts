"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CollaborationClientMessage,
  CollaborationServerMessage,
  Gen2WorkspaceMember,
} from "@codev/contracts";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";

import { useWorkspaceRealtime } from "./use-workspace-realtime";
import {
  isAgentEditOrigin,
  type AgentEditOrigin,
} from "./codemirror-yjs-binding";
import { memberColor } from "./member-color";
import { agentLabel } from "./agent-label";
import { decodeBase64, encodeBase64 } from "./workspace-realtime-socket";

export const REMOTE_ORIGIN = "codev-remote";
const SAVE_SETTLE_MS = 300;

const isRemoteOrigin = (origin: unknown) =>
  origin === REMOTE_ORIGIN || isAgentEditOrigin(origin);

/** An agent's edit carries who made it, so the editor can type it out. */
function agentOrigin(
  message: Reconciled,
  members: Gen2WorkspaceMember[],
): AgentEditOrigin | null {
  const actor = message.actor;
  if (actor?.kind !== "agent") return null;
  return {
    agent: true,
    id: actor.sessionId,
    label: agentLabel(
      actor.provider,
      members.find((member) => member.userId === actor.ownerUserId)?.name ??
        members.find((member) => member.userId === actor.ownerUserId)?.login ??
        "A member",
    ),
    color: memberColor(actor.sessionId).color,
  };
}

export type Gen2DocumentConnectionState =
  | "idle"
  | "connecting"
  | "syncing"
  | "connected"
  | "disconnected"
  | "conflict";

type Reconciled = Extract<CollaborationServerMessage, { type: "reconciled" }>;

interface OpenDocument {
  key: string;
  doc: Y.Doc;
  text: Y.Text;
  awareness: Awareness;
}

/** Sends local edits and cursor moves once the document has synced. */
function bindLocal(
  open: OpenDocument,
  path: string,
  worktreeId: string,
  send: (message: CollaborationClientMessage) => void,
  synced: () => boolean,
  onEdit: () => void,
) {
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (isRemoteOrigin(origin) || !synced()) return;
    send({ type: "update", worktreeId, path, update: encodeBase64(update) });
    onEdit();
  };
  const onAwareness = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    const clients = [...changes.added, ...changes.updated, ...changes.removed];
    if (isRemoteOrigin(origin) || !synced() || !clients.length) return;
    const update = encodeAwarenessUpdate(open.awareness, clients);
    send({ type: "awareness", worktreeId, path, update: encodeBase64(update) });
  };
  open.doc.on("update", onUpdate);
  open.awareness.on("update", onAwareness);
  return () => {
    open.doc.off("update", onUpdate);
    open.awareness.off("update", onAwareness);
  };
}

/**
 * Browser-safe CoDev adapter for one open Gen 2 file, multiplexed over the
 * workspace tab's realtime socket. Superset's shared-file interaction model
 * stays above this hook; all desktop host and store dependencies stop here.
 */
export function useGen2SharedFileDocument(input: {
  workspaceId: string;
  worktreeId: string;
  path: string | null;
  canEdit: boolean;
  onContentsChange: (contents: string) => void;
}) {
  const realtime = useWorkspaceRealtime();
  const { send, listen, generation, status, presence } = realtime;
  const { worktreeId, path, canEdit } = input;
  const key = path ? `${worktreeId}\0${path}` : null;
  const [open, setOpen] = useState<OpenDocument | null>(null);
  const [synced, setSynced] = useState<{ key: string; generation: number }>();
  const [conflictKey, setConflictKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(
    null,
  );
  // Edits autosave on the server; this is "unsaved" until it reports a write.
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const lastEditAt = useRef(0);
  const syncedRef = useRef(false);
  const callbacks = useRef(input);
  const membersRef = useRef(realtime.members);
  useEffect(() => {
    callbacks.current = input;
    membersRef.current = realtime.members;
  });

  // The Yjs resource is keyed by file; publishing its handle is the point.
  useEffect(() => {
    if (!key) return;
    const doc = new Y.Doc();
    const text = doc.getText("content");
    const next = { key, doc, text, awareness: new Awareness(doc) };
    const onText = () => callbacks.current.onContentsChange(text.toString());
    text.observe(onText);
    syncedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(next);
    return () => {
      text.unobserve(onText);
      next.awareness.destroy();
      doc.destroy();
    };
  }, [key]);

  useEffect(() => {
    if (!open || open.key !== key || !path) return;
    const unbind = bindLocal(
      open,
      path,
      worktreeId,
      send,
      () => syncedRef.current,
      () => {
        lastEditAt.current = Date.now();
        setSavingKey(open.key);
      },
    );
    const unlisten = listen((message) => {
      if (!("path" in message) || message.path !== path) return;
      if ("worktreeId" in message && message.worktreeId !== worktreeId) return;
      applyDocumentMessage(open, message, {
        synced: () => {
          syncedRef.current = true;
          setSynced({ key: open.key, generation });
          setNotice(null);
        },
        conflict: () => setConflictKey(open.key),
        resolved: () => {
          setConflictKey(null);
          setNotice(null);
        },
        saved: () => {
          // A write that began before the latest keystroke is not the last one.
          if (Date.now() - lastEditAt.current >= SAVE_SETTLE_MS)
            setSavingKey(null);
        },
        notice: (text) => setNotice({ key: open.key, text }),
        originFor: (edit) =>
          agentOrigin(edit, membersRef.current) ?? REMOTE_ORIGIN,
        sendMissing: (update) => {
          if (canEdit) send({ type: "update", worktreeId, path, update });
        },
      });
    });
    return () => {
      unlisten();
      unbind();
    };
  }, [open, key, path, worktreeId, generation, canEdit, send, listen]);

  // Every (re)connect resubscribes, sending what this tab already holds.
  useEffect(() => {
    if (!open || open.key !== key || !path || status !== "open") return;
    send({
      type: "subscribe",
      worktreeId,
      path,
      stateVector: syncedRef.current
        ? encodeBase64(Y.encodeStateVector(open.doc))
        : undefined,
    });
    return () => send({ type: "unsubscribe", worktreeId, path });
  }, [open, key, path, worktreeId, status, generation, send]);

  /** Ends a conflict for every editor: keep the shared text or the file's. */
  const resolveConflict = useCallback(
    (keep: "editor" | "workspace") => {
      if (path) send({ type: "resolve", worktreeId, path, keep });
    },
    [path, worktreeId, send],
  );

  const updateCursor = useCallback(
    (cursor: { anchor: number; head: number } | null) =>
      open?.awareness.setLocalStateField("cursor", cursor),
    [open],
  );

  const members = useMemo(
    () =>
      presence.filter(
        (member) =>
          !member.agent &&
          member.worktreeId === worktreeId &&
          member.path === path,
      ),
    [presence, worktreeId, path],
  );

  const current = open && open.key === key ? open : null;
  const state = documentState({
    open: Boolean(current),
    conflict: Boolean(current && conflictKey === current.key),
    socketOpen: status === "open",
    synced: Boolean(current && synced?.key === current.key),
    current: synced?.generation === generation,
  });
  const disconnectedNotice =
    state === "disconnected"
      ? "Collaboration disconnected. Reconnecting…"
      : null;
  return {
    text: current?.text ?? null,
    awareness: current?.awareness ?? null,
    state,
    notice:
      disconnectedNotice ??
      (current && notice?.key === current.key ? notice.text : null),
    members,
    updateCursor,
    resolveConflict,
    readOnly: !canEdit || state !== "connected",
    /** Edits the workspace file does not have yet; they autosave shortly. */
    saving: Boolean(current && savingKey === current.key),
  };
}

function documentState(input: {
  open: boolean;
  conflict: boolean;
  socketOpen: boolean;
  synced: boolean;
  current: boolean;
}): Gen2DocumentConnectionState {
  if (!input.open) return "idle";
  if (input.conflict) return "conflict";
  if (!input.socketOpen) return input.synced ? "disconnected" : "connecting";
  if (!input.synced) return "connecting";
  return input.current ? "connected" : "syncing";
}

/** Applies one server message for this document to the local Yjs state. */
function applyDocumentMessage(
  open: OpenDocument,
  message: CollaborationServerMessage,
  on: {
    synced: () => void;
    conflict: () => void;
    resolved: () => void;
    saved: () => void;
    notice: (text: string) => void;
    originFor: (message: Reconciled) => unknown;
    sendMissing: (update: string) => void;
  },
) {
  if (message.type === "sync") {
    Y.applyUpdate(open.doc, decodeBase64(message.update), REMOTE_ORIGIN);
    on.synced();
    // Edits made while disconnected that the server never received.
    const missing = Y.encodeStateAsUpdate(
      open.doc,
      decodeBase64(message.stateVector),
    );
    if (missing.length > 2) on.sendMissing(encodeBase64(missing));
  } else if (message.type === "update" || message.type === "reconciled") {
    const origin =
      message.type === "reconciled" ? on.originFor(message) : REMOTE_ORIGIN;
    if (message.update)
      Y.applyUpdate(open.doc, decodeBase64(message.update), origin);
    if (message.type !== "reconciled") return;
    // The document and the file agree again, whatever conflict there was.
    on.resolved();
    if (message.source === "collaboration") on.saved();
    else on.notice(reconciledNotice(origin));
  } else if (message.type === "awareness") {
    applyAwarenessUpdate(
      open.awareness,
      decodeBase64(message.update),
      REMOTE_ORIGIN,
    );
  } else if (message.type === "conflict") {
    on.conflict();
    on.notice(message.message);
  } else if (message.type === "error") {
    on.notice(message.message);
    if (message.code === "conflict") on.conflict();
  }
}

function reconciledNotice(origin: unknown) {
  return isAgentEditOrigin(origin)
    ? `${origin.label} updated this file.`
    : "This file changed in the workspace.";
}
