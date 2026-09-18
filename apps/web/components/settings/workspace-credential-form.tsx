"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function WorkspaceCredentialForm({
  workspaceId,
  provider,
  currentLastFour,
}: {
  workspaceId: string;
  provider: "openai" | "anthropic" | "cursor";
  currentLastFour?: string | undefined;
}) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const providerName =
    provider === "openai"
      ? "OpenAI"
      : provider === "anthropic"
        ? "Anthropic"
        : "Cursor";
  const endpoint = `/api/workspaces/${workspaceId}/credentials`;

  async function save() {
    setSaving(true);
    setMessage("");
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        credentialType: "API_KEY",
        apiKey: apiKey.trim(),
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    setSaving(false);
    if (!response.ok) {
      setMessage(payload?.error ?? "The workspace key could not be saved.");
      return;
    }
    setApiKey("");
    setMessage(`${providerName} workspace key saved securely.`);
    router.refresh();
  }

  async function remove() {
    setSaving(true);
    setMessage("");
    const response = await fetch(`${endpoint}?provider=${provider}`, {
      method: "DELETE",
    });
    setSaving(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setMessage(payload?.error ?? "The workspace key could not be removed.");
      return;
    }
    setMessage(`${providerName} workspace key removed.`);
    router.refresh();
  }

  return (
    <div className="credential-form">
      <div className="credential-status">
        <span className={currentLastFour ? "dot-ready" : "dot-muted"} />
        <div>
          <strong>
            {currentLastFour
              ? `Key ending in ${currentLastFour}`
              : "No shared key connected"}
          </strong>
          <small>Encrypted before storage and used as teammate fallback.</small>
        </div>
      </div>
      <label>
        <span>{providerName} workspace API key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={
            provider === "openai"
              ? "sk-…"
              : provider === "anthropic"
                ? "sk-ant-…"
                : "key_…"
          }
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="form-actions">
        <button
          className="primary-button"
          type="button"
          disabled={apiKey.trim().length < 20 || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : currentLastFour ? "Replace key" : "Save key"}
        </button>
        {currentLastFour ? (
          <button
            className="danger-button"
            type="button"
            disabled={saving}
            onClick={() => void remove()}
          >
            Remove
          </button>
        ) : null}
      </div>
      {message ? <p className="form-message">{message}</p> : null}
    </div>
  );
}
