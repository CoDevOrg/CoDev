"use client";

import type { editor as MonacoEditor } from "monaco-editor";
import type {
  CollaborationClientMessage,
  CollaborationPresenceEntry,
  CollaborationServerMessage,
} from "@codev/contracts";
import { MonacoBinding } from "y-monaco";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";

const REMOTE_ORIGIN = Symbol("codev-remote");
const reconnectCeilingMs = 30_000;

export type CollaborationStatus =
  | "connecting"
  | "online"
  | "reconnecting"
  | "offline";

export interface CollaborationUser {
  id: string;
  login: string;
  name?: string | null;
  image?: string | null;
  color: string;
  activePath?: string | null;
}

export interface CollaborationConflict {
  path: string;
  message: string;
  detectedAt?: string;
}

interface DocumentSession {
  path: string;
  doc: Y.Doc;
  text: Y.Text;
  awareness: Awareness;
  binding: MonacoBinding | null;
  editor: MonacoEditor.IStandaloneCodeEditor | null;
  synced: boolean;
}

interface CollaborationCallbacks {
  onStatus(status: CollaborationStatus): void;
  onPresence(users: CollaborationUser[]): void;
  onConflict(conflict: CollaborationConflict | null): void;
  onReconciled(path: string, revision: string, contents: string): void;
  onDocument(path: string, contents: string, synced: boolean): void;
  onError(message: string): void;
}

function toBase64(value: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function websocketUrl(workspaceId: string) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/workspaces/${workspaceId}/collaboration`;
}

function presenceUser(entry: CollaborationPresenceEntry): CollaborationUser {
  return {
    id: entry.user.id,
    login: entry.user.login,
    name: entry.user.name,
    image: entry.user.avatarUrl,
    color: userColor(entry.user.id),
    activePath: entry.path,
  };
}

function userColor(value: string) {
  const palette = ["#46e6c1", "#64b7d0", "#c69df5", "#efb16d", "#f07f95"];
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length]!;
}

export class WorkspaceCollaboration {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectDelay = 1_000;
  private stopped = false;
  private joined = false;
  private active: DocumentSession | null = null;

  constructor(
    private readonly workspaceId: string,
    private readonly user: Omit<CollaborationUser, "color"> & {
      color?: string;
    },
    private readonly callbacks: CollaborationCallbacks,
  ) {}

  connect() {
    this.stopped = false;
    this.openSocket("connecting");
  }

  private openSocket(status: CollaborationStatus) {
    if (this.stopped) return;
    this.callbacks.onStatus(status);
    const socket = new WebSocket(websocketUrl(this.workspaceId));
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.stopped || this.socket !== socket) return;
      this.reconnectDelay = 1_000;
      this.joined = false;
      this.callbacks.onStatus("online");
      this.send({ type: "join" });
      this.startHeartbeat();
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        this.receive(JSON.parse(event.data) as CollaborationServerMessage);
      } catch {
        this.callbacks.onError(
          "The collaboration gateway sent an invalid event.",
        );
      }
    });

    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = null;
      this.joined = false;
      this.stopHeartbeat();
      if (this.stopped) {
        this.callbacks.onStatus("offline");
        return;
      }
      this.callbacks.onStatus("reconnecting");
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.openSocket("reconnecting");
      }, this.reconnectDelay);
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        reconnectCeilingMs,
      );
    });

    socket.addEventListener("error", () => {
      if (this.socket === socket) {
        this.callbacks.onStatus("reconnecting");
      }
    });
  }

  openDocument(path: string, editor: MonacoEditor.IStandaloneCodeEditor) {
    if (this.active?.path === path && this.active.editor === editor) return;
    this.closeDocument();
    const doc = new Y.Doc();
    const text = doc.getText("content");
    const awareness = new Awareness(doc);
    const session: DocumentSession = {
      path,
      doc,
      text,
      awareness,
      binding: null,
      editor,
      synced: false,
    };
    this.active = session;
    awareness.setLocalStateField("user", {
      id: this.user.id,
      login: this.user.login,
      name: this.user.name ?? this.user.login,
      avatarUrl: this.user.image ?? null,
      color: this.user.color ?? userColor(this.user.id),
      activePath: path,
    });

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      this.callbacks.onDocument(path, text.toString(), session.synced);
      if (origin === REMOTE_ORIGIN || !session.synced) return;
      this.send({ type: "update", path, update: toBase64(update) });
    });
    awareness.on(
      "update",
      (
        changes: {
          added: number[];
          updated: number[];
          removed: number[];
        },
        origin: unknown,
      ) => {
        if (origin === REMOTE_ORIGIN) return;
        const clients = [
          ...changes.added,
          ...changes.updated,
          ...changes.removed,
        ];
        if (clients.length === 0) return;
        this.send({
          type: "awareness",
          path,
          update: toBase64(encodeAwarenessUpdate(awareness, clients)),
        });
      },
    );

    if (this.joined) this.subscribe(session);
  }

  private subscribe(session: DocumentSession) {
    session.synced = false;
    this.send({
      type: "subscribe",
      path: session.path,
      stateVector: toBase64(Y.encodeStateVector(session.doc)),
    });
  }

  private bind(session: DocumentSession) {
    if (session.binding || !session.editor) return;
    const model = session.editor.getModel();
    if (!model) return;
    session.binding = new MonacoBinding(
      session.text,
      model,
      new Set([session.editor]),
      session.awareness,
    );
  }

  private receive(message: CollaborationServerMessage) {
    if (message.type === "welcome") {
      this.joined = true;
      if (this.active) this.subscribe(this.active);
      return;
    }
    if (message.type === "presence") {
      this.callbacks.onPresence(message.members.map(presenceUser));
      return;
    }
    if (message.type === "error") {
      this.callbacks.onError(message.message);
      return;
    }

    const session = this.active;
    if (!session || !("path" in message) || message.path !== session.path) {
      return;
    }

    if (message.type === "sync") {
      Y.applyUpdate(session.doc, fromBase64(message.update), REMOTE_ORIGIN);
      const localDiff = Y.encodeStateAsUpdate(
        session.doc,
        fromBase64(message.stateVector),
      );
      session.synced = true;
      this.bind(session);
      this.callbacks.onDocument(session.path, session.text.toString(), true);
      this.callbacks.onReconciled(
        session.path,
        message.revision,
        session.text.toString(),
      );
      this.callbacks.onConflict(null);
      if (localDiff.byteLength > 2) {
        this.send({
          type: "update",
          path: session.path,
          update: toBase64(localDiff),
        });
      }
      return;
    }
    if (message.type === "update") {
      Y.applyUpdate(session.doc, fromBase64(message.update), REMOTE_ORIGIN);
      this.callbacks.onReconciled(
        session.path,
        message.revision,
        session.text.toString(),
      );
      this.callbacks.onConflict(null);
      return;
    }
    if (message.type === "awareness") {
      applyAwarenessUpdate(
        session.awareness,
        fromBase64(message.update),
        REMOTE_ORIGIN,
      );
      return;
    }
    if (message.type === "reconciled") {
      if (message.update) {
        Y.applyUpdate(session.doc, fromBase64(message.update), REMOTE_ORIGIN);
      }
      this.callbacks.onReconciled(
        session.path,
        message.revision,
        session.text.toString(),
      );
      this.callbacks.onConflict(null);
      return;
    }
    if (message.type === "conflict") {
      this.callbacks.onConflict(message);
    }
  }

  private send(message: CollaborationClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ type: "heartbeat" });
    }, 15_000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  closeDocument() {
    const session = this.active;
    if (!session) return;
    const remoteClients = [...session.awareness.getStates().keys()].filter(
      (client) => client !== session.awareness.clientID,
    );
    if (remoteClients.length > 0) {
      removeAwarenessStates(session.awareness, remoteClients, REMOTE_ORIGIN);
    }
    session.awareness.setLocalState(null);
    session.binding?.destroy();
    session.awareness.destroy();
    session.doc.destroy();
    this.active = null;
  }

  destroy() {
    this.stopped = true;
    this.closeDocument();
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close(1000, "workspace closed");
    this.socket = null;
    this.joined = false;
    this.callbacks.onStatus("offline");
  }
}
