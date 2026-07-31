"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import type { editor as MonacoEditor } from "monaco-editor";
import { MonacoBinding } from "y-monaco";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import type {
  CollaborationConflict,
  CollaborationStatus,
  CollaborationUser,
} from "./collaboration-client";

type Callbacks = {
  onStatus(status: CollaborationStatus): void;
  onPresence(users: CollaborationUser[]): void;
  onConflict(conflict: CollaborationConflict | null): void;
  onReconciled(path: string, revision: string, contents: string): void;
  onDocument(path: string, contents: string, synced: boolean): void;
  onError(message: string): void;
};

function userColor(value: string) {
  const palette = ["#d4af37", "#7d93c4", "#c9a84a", "#8fa3c8", "#e0b84a"];
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length]!;
}

function hocuspocusUrl() {
  const configured = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
  return configured ? configured.replace(/\/$/, "") : "";
}

export function hocuspocusConfigured() {
  return Boolean(hocuspocusUrl());
}

export class HocuspocusWorkspaceCollaboration {
  private provider: HocuspocusProvider | null = null;
  private active: {
    path: string;
    doc: Y.Doc;
    text: Y.Text;
    awareness: Awareness;
    binding: MonacoBinding | null;
    editor: MonacoEditor.IStandaloneCodeEditor;
  } | null = null;
  private tokenPromise: Promise<string> | null = null;
  private tokenExpiresAt = 0;
  private stopped = false;

  constructor(
    private readonly workspaceId: string,
    private readonly user: {
      id: string;
      login: string;
      name?: string | null;
      image?: string | null;
    },
    private readonly callbacks: Callbacks,
  ) {}

  connect() {
    this.stopped = false;
    this.callbacks.onStatus("connecting");
    void this.getToken().then(
      () => this.callbacks.onStatus("online"),
      (error: unknown) =>
        this.callbacks.onError(
          error instanceof Error
            ? error.message
            : "Hocuspocus authentication failed.",
        ),
    );
  }

  private getToken() {
    if (this.tokenPromise && this.tokenExpiresAt > Date.now() + 30_000) {
      return this.tokenPromise;
    }
    this.tokenPromise = fetch(
      `/api/workspaces/${this.workspaceId}/collaboration/hocuspocus-token`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          token?: string;
          expiresAt?: number;
          error?: string;
        } | null;
        if (
          !response.ok ||
          !payload?.token ||
          typeof payload.expiresAt !== "number" ||
          !Number.isFinite(payload.expiresAt)
        ) {
          throw new Error(
            payload?.error ?? "Could not authenticate collaboration.",
          );
        }
        if (payload.expiresAt <= Date.now() + 30_000) {
          throw new Error("Collaboration token is already expired.");
        }
        this.tokenExpiresAt = payload.expiresAt;
        return payload.token;
      })
      .catch((error: unknown) => {
        this.tokenPromise = null;
        this.tokenExpiresAt = 0;
        throw error;
      });
    return this.tokenPromise;
  }

  openDocument(path: string, editor: MonacoEditor.IStandaloneCodeEditor) {
    if (this.active?.path === path && this.active.editor === editor) return;
    this.closeDocument();
    const doc = new Y.Doc();
    const text = doc.getText("content");
    const awareness = new Awareness(doc);
    const active = {
      path,
      doc,
      text,
      awareness,
      binding: null as MonacoBinding | null,
      editor,
    };
    this.active = active;
    awareness.setLocalStateField("user", {
      id: this.user.id,
      login: this.user.login,
      name: this.user.name ?? this.user.login,
      avatarUrl: this.user.image ?? null,
      color: userColor(this.user.id),
      activePath: path,
    });

    doc.on("update", () => {
      if (this.active === active) {
        this.callbacks.onDocument(
          path,
          text.toString(),
          Boolean(this.provider?.isSynced),
        );
      }
    });

    const provider = new HocuspocusProvider({
      url: hocuspocusUrl(),
      name: `workspace:${this.workspaceId}:${path}`,
      document: doc,
      awareness,
      token: () => this.getToken(),
      onStatus: ({ status }) => {
        this.callbacks.onStatus(
          status === "connected"
            ? "online"
            : status === "connecting"
              ? "connecting"
              : "reconnecting",
        );
      },
      onSynced: ({ state }) => {
        if (!state || this.active !== active) return;
        if (text.length === 0 && editor.getValue()) {
          text.insert(0, editor.getValue());
        }
        const model = editor.getModel();
        if (!model) return;
        active.binding = new MonacoBinding(
          text,
          model,
          new Set([editor]),
          awareness,
        );
        this.callbacks.onDocument(path, text.toString(), true);
        this.callbacks.onReconciled(path, "hocuspocus", text.toString());
        this.callbacks.onConflict(null);
      },
      onAwarenessChange: ({ states }) => {
        const users = states.flatMap((state) => {
          const user = state.user as
            | {
                id?: string;
                login?: string;
                name?: string | null;
                avatarUrl?: string | null;
                color?: string;
                activePath?: string | null;
              }
            | undefined;
          if (!user?.id || !user.login) return [];
          return [
            {
              id: user.id,
              login: user.login,
              name: user.name ?? null,
              image: user.avatarUrl ?? null,
              color: user.color ?? userColor(user.id),
              activePath: user.activePath ?? null,
            },
          ];
        });
        this.callbacks.onPresence(users);
      },
      onAuthenticationFailed: ({ reason }) => {
        this.tokenPromise = null;
        this.tokenExpiresAt = 0;
        this.callbacks.onError(reason);
      },
    });
    this.provider = provider;
    void provider.connect().catch((error: unknown) => {
      if (!this.stopped) {
        this.callbacks.onError(
          error instanceof Error
            ? error.message
            : "Hocuspocus connection failed.",
        );
      }
    });
  }

  closeDocument() {
    this.active?.binding?.destroy();
    this.active?.awareness.setLocalState(null);
    this.active?.awareness.destroy();
    this.active?.doc.destroy();
    this.active = null;
    this.provider?.destroy();
    this.provider = null;
  }

  destroy() {
    this.stopped = true;
    this.closeDocument();
    this.callbacks.onStatus("offline");
  }
}
