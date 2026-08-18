"use client";

import { useState } from "react";

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
  const [message, setMessage] = useState<{
    tone: "success" | "warning";
    text: string;
  } | null>(null);

  async function save(provider: ProviderConnectionProvider) {
    const apiKey = drafts[provider]?.trim() ?? "";
    setBusy(`save:${provider}`);
    setMessage(null);
    try {
      const response = await fetch("/api/personal/connections", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({
          tone: "warning",
          text: payload?.error ?? "The key could not be saved.",
        });
        return;
      }
      setSnapshot(payload);
      setDrafts((current) => ({ ...current, [provider]: "" }));
      setMessage({
        tone: "success",
        text: `${provider === "openai" ? "OpenAI" : "Anthropic"} key saved.`,
      });
    } finally {
      setBusy("");
    }
  }

  async function revoke(provider: ProviderConnectionProvider) {
    setBusy(`revoke:${provider}`);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/personal/connections?provider=${provider}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({
          tone: "warning",
          text: payload?.error ?? "The connection could not be revoked.",
        });
        return;
      }
      setSnapshot(payload);
      setDrafts((current) => ({ ...current, [provider]: "" }));
      setMessage({
        tone: "success",
        text: `${provider === "openai" ? "OpenAI" : "Anthropic"} connection revoked.`,
      });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="provider-connections-panel">
      <ul
        className="provider-connections-list"
        aria-label="Provider connection status"
      >
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
            <li className="provider-connection-card" key={connection.provider}>
              <p className="provider-connection-title">{connection.label}</p>
              <p className="settings-muted-copy">{statusLabel(connection)}</p>
              {cli ? (
                <p className="settings-muted-copy">
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
              <div className="provider-connection-actions">
                <label
                  className="sr-only"
                  htmlFor={`provider-key-${connection.provider}`}
                >
                  {connection.label} API key
                </label>
                <input
                  autoComplete="off"
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
                <button
                  className="primary-button"
                  disabled={disabled}
                  onClick={() => void save(connection.provider)}
                  type="button"
                >
                  {saving
                    ? "Saving…"
                    : connection.status === "connected"
                      ? "Replace key"
                      : "Save key"}
                </button>
                {connection.status === "connected" ? (
                  <button
                    className="secondary-button"
                    disabled={disabled}
                    onClick={() => void revoke(connection.provider)}
                    type="button"
                  >
                    {revoking ? "Revoking…" : "Revoke"}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {message ? (
        <p
          className={`form-message ${message.tone === "warning" ? "is-warning" : ""}`}
          role={message.tone === "success" ? "status" : "alert"}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
