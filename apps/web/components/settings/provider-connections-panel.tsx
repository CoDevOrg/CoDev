"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  ProviderConnectionProvider,
  ProviderConnectionSnapshot,
} from "@/lib/provider-connection-view";

function statusLabel(
  connection: ProviderConnectionSnapshot["connections"][number],
): string {
  if (connection.status !== "connected") return "Not connected";
  const ending = connection.lastFour ? ` · ending ${connection.lastFour}` : "";
  const owner = connection.suppliedBy
    ? ` · supplied by ${connection.suppliedBy}`
    : "";
  const kind =
    connection.credentialType === "OAUTH_TOKEN" ? "OAuth" : "API key";
  return `Connected · ${kind}${owner}${ending}`;
}

export function ProviderConnectionsPanel({
  initialSnapshot,
}: {
  initialSnapshot: ProviderConnectionSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [drafts, setDrafts] = useState<
    Partial<Record<ProviderConnectionProvider, string>>
  >({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function save(provider: ProviderConnectionProvider) {
    const apiKey = drafts[provider]?.trim() ?? "";
    setBusy(`save:${provider}`);
    setMessage("");
    try {
      const response = await fetch("/api/personal/connections", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "The key could not be saved.");
        return;
      }
      setSnapshot(payload);
      setDrafts((current) => ({ ...current, [provider]: "" }));
      setMessage(
        `${provider === "openai" ? "OpenAI" : "Anthropic"} key saved.`,
      );
    } finally {
      setBusy("");
    }
  }

  async function revoke(provider: ProviderConnectionProvider) {
    setBusy(`revoke:${provider}`);
    setMessage("");
    try {
      const response = await fetch(
        `/api/personal/connections?provider=${provider}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "The connection could not be revoked.");
        return;
      }
      setSnapshot(payload);
      setDrafts((current) => ({ ...current, [provider]: "" }));
      setMessage(
        `${provider === "openai" ? "OpenAI" : "Anthropic"} connection revoked.`,
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-3">
      <ul aria-label="Provider connection status" className="space-y-2">
        {snapshot.connections.map((connection) => {
          const saving = busy === `save:${connection.provider}`;
          const revoking = busy === `revoke:${connection.provider}`;
          const disabled = busy !== "";
          const cli = snapshot.cliSubscriptions.find(
            (subscription) =>
              subscription.provider ===
              (connection.provider === "openai" ? "codex" : "claude"),
          );
          return (
            <li
              className="space-y-2 rounded-md border border-border p-3"
              key={connection.provider}
            >
              <p className="text-sm font-medium">{connection.label}</p>
              <p className="text-xs text-muted-foreground">
                {statusLabel(connection)}
              </p>
              {cli ? (
                <p className="text-xs text-muted-foreground">
                  {cli.label} CLI:{" "}
                  {cli.status === "connected" ? (
                    "Connected"
                  ) : (
                    <>
                      Not connected · run <code>{cli.command}</code> · or paste
                      an API key below instead
                    </>
                  )}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className="sr-only"
                  htmlFor={`provider-key-${connection.provider}`}
                >
                  {connection.label} API key
                </label>
                <input
                  autoComplete="off"
                  className="h-8 min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 text-xs"
                  disabled={disabled}
                  id={`provider-key-${connection.provider}`}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [connection.provider]: event.target.value,
                    }))
                  }
                  placeholder="Paste API key"
                  spellCheck={false}
                  type="password"
                  value={drafts[connection.provider] ?? ""}
                />
                <Button
                  disabled={disabled}
                  onClick={() => void save(connection.provider)}
                  size="sm"
                  type="button"
                >
                  {saving
                    ? "Saving…"
                    : connection.status === "connected"
                      ? "Replace key"
                      : "Save key"}
                </Button>
                {connection.status === "connected" ? (
                  <Button
                    disabled={disabled}
                    onClick={() => void revoke(connection.provider)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {revoking ? "Revoking…" : "Revoke"}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {message ? (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
