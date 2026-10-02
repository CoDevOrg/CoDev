"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  CliSubscriptionRecord,
  ProviderConnectionProvider,
  ProviderConnectionRecord,
} from "@/lib/providers/provider-connection-view";

type Busy = "disconnect" | "save" | "revoke" | "";

type AccountHandlers = {
  provider: ProviderConnectionProvider;
  label: string;
  apiKeyLabel: string;
  draft: string;
  subscriptionProvider: CliSubscriptionRecord["provider"];
  setBusy: (busy: Busy) => void;
  setMessage: (message: string) => void;
  setConnected: (connected: boolean) => void;
  setApiKeyState: (connection: ProviderConnectionRecord) => void;
  setDraft: (draft: string) => void;
  refresh: () => void;
};

async function readPayload(response: Response) {
  return (await response.json().catch(() => null)) as {
    error?: string;
    connections?: ProviderConnectionRecord[];
  } | null;
}

export function useProviderAccountCard({
  connection,
  label,
  subscription,
}: {
  connection: ProviderConnectionRecord;
  label: string;
  subscription: CliSubscriptionRecord;
}) {
  const router = useRouter();
  const [apiKeyState, setApiKeyState] = useState(connection);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<Busy>("");
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(
    subscription.status === "connected",
  );
  const provider = connection.provider;
  const apiKeyLabel = `${connection.label} API key`;
  const handlers: AccountHandlers = {
    provider,
    label,
    apiKeyLabel,
    draft,
    subscriptionProvider: subscription.provider,
    setBusy,
    setMessage,
    setConnected,
    setApiKeyState,
    setDraft,
    refresh: () => router.refresh(),
  };

  return {
    apiKeyState,
    draft,
    setDraft,
    busy,
    message,
    connected,
    disabled: busy !== "",
    apiKeyLabel,
    finishConnected: () => finishConnected(handlers),
    disconnect: () => disconnectAccount(handlers),
    save: () => saveApiKey(handlers),
    revoke: () => revokeApiKey(handlers),
    setSharedWorkspaceUse: (
      kind: "api_key" | "subscription" | "claude_cli_token",
      enabled: boolean,
    ) => setSharedWorkspaceUse(handlers, kind, enabled),
    revokeClaudeCliToken: () => revokeClaudeCliToken(handlers),
  };
}

function finishConnected(handlers: AccountHandlers) {
  handlers.setBusy("");
  handlers.setConnected(true);
  handlers.setMessage(`${handlers.label} is connected.`);
  handlers.refresh();
}

async function disconnectAccount(handlers: AccountHandlers) {
  handlers.setBusy("disconnect");
  handlers.setMessage("");
  try {
    const response = await fetch(
      `/api/personal/subscriptions?provider=${handlers.subscriptionProvider}`,
      { method: "DELETE" },
    );
    const payload = await readPayload(response);
    if (!response.ok) {
      handlers.setMessage(
        payload?.error ?? "The account could not be disconnected.",
      );
      return;
    }
    handlers.setConnected(false);
    handlers.setMessage(`${handlers.label} disconnected.`);
    handlers.refresh();
  } finally {
    handlers.setBusy("");
  }
}

async function saveApiKey(handlers: AccountHandlers) {
  handlers.setBusy("save");
  handlers.setMessage("");
  try {
    const response = await fetch("/api/personal/connections", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: handlers.provider,
        apiKey: handlers.draft.trim(),
      }),
    });
    const payload = await readPayload(response);
    if (!response.ok) {
      handlers.setMessage(payload?.error ?? "The key could not be saved.");
      return;
    }
    const next = payload?.connections?.find(
      (row) => row.provider === handlers.provider,
    );
    if (next) handlers.setApiKeyState(next);
    handlers.setDraft("");
    handlers.setMessage(`${handlers.apiKeyLabel} saved.`);
  } finally {
    handlers.setBusy("");
  }
}

async function revokeApiKey(handlers: AccountHandlers) {
  handlers.setBusy("revoke");
  handlers.setMessage("");
  try {
    const response = await fetch(
      `/api/personal/connections?provider=${handlers.provider}`,
      { method: "DELETE" },
    );
    const payload = await readPayload(response);
    if (!response.ok) {
      handlers.setMessage(payload?.error ?? "The key could not be revoked.");
      return;
    }
    const next = payload?.connections?.find(
      (row) => row.provider === handlers.provider,
    );
    if (next) handlers.setApiKeyState(next);
    handlers.setDraft("");
    handlers.setMessage(`${handlers.apiKeyLabel} revoked.`);
  } finally {
    handlers.setBusy("");
  }
}

async function setSharedWorkspaceUse(
  handlers: AccountHandlers,
  kind: "api_key" | "subscription" | "claude_cli_token",
  enabled: boolean,
) {
  handlers.setBusy("save");
  handlers.setMessage("");
  try {
    const response = await fetch("/api/personal/connections", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: handlers.provider,
        kind,
        allowInSharedWorkspaces: enabled,
      }),
    });
    const payload = await readPayload(response);
    if (!response.ok) {
      handlers.setMessage(payload?.error ?? "The setting could not be saved.");
      return;
    }
    handlers.setMessage(
      enabled
        ? `${handlers.label} can be used in shared workspaces.`
        : `${handlers.label} will stay out of shared workspaces.`,
    );
    handlers.refresh();
  } finally {
    handlers.setBusy("");
  }
}

async function revokeClaudeCliToken(handlers: AccountHandlers) {
  handlers.setBusy("revoke");
  handlers.setMessage("");
  try {
    const response = await fetch(
      "/api/personal/connections?provider=anthropic&kind=claude_cli_token",
      { method: "DELETE" },
    );
    const payload = await readPayload(response);
    if (!response.ok) {
      handlers.setMessage(
        payload?.error ?? "The CLI login could not be revoked.",
      );
      return;
    }
    handlers.setMessage(`${handlers.label} CLI login revoked.`);
    handlers.refresh();
  } finally {
    handlers.setBusy("");
  }
}
