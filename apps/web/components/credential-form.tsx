"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ApiKeyProvider = "openai" | "anthropic" | "cursor";

const PROVIDER_LABELS: Record<ApiKeyProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  cursor: "Cursor",
};

const PROVIDER_PLACEHOLDERS: Record<ApiKeyProvider, string> = {
  openai: "sk-…",
  anthropic: "sk-ant-…",
  cursor: "key_…",
};

function saveEndpoint(provider: ApiKeyProvider) {
  if (provider === "openai") return "/api/settings/openai-key";
  if (provider === "anthropic") return "/api/settings/anthropic-key";
  return "/api/settings/provider-credential";
}

function saveBody(provider: ApiKeyProvider, apiKey: string) {
  if (provider === "cursor") {
    return JSON.stringify({
      provider: "cursor",
      credentialType: "API_KEY",
      apiKey,
    });
  }
  return JSON.stringify({ apiKey });
}

function deleteEndpoint(provider: ApiKeyProvider) {
  if (provider === "openai") return "/api/settings/openai-key";
  if (provider === "anthropic") return "/api/settings/anthropic-key";
  return "/api/settings/provider-credential?provider=cursor";
}

export function CredentialForm({
  currentLastFour,
  provider = "openai",
}: {
  currentLastFour: string | undefined;
  provider?: ApiKeyProvider;
}) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const providerName = PROVIDER_LABELS[provider];

  async function save() {
    setSaving(true);
    setMessage("");
    const response = await fetch(saveEndpoint(provider), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: saveBody(provider, apiKey),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "The key could not be saved.");
      setSaving(false);
      return;
    }
    setApiKey("");
    setMessage(`${providerName} key saved securely.`);
    setSaving(false);
    router.refresh();
  }

  async function remove() {
    setSaving(true);
    setMessage("");
    const response = await fetch(deleteEndpoint(provider), { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setMessage(payload.error ?? "The key could not be removed.");
    } else {
      setMessage(`${providerName} key removed.`);
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <div className="credential-form">
      <div className="credential-status">
        <span className={currentLastFour ? "dot-ready" : "dot-muted"} />
        <div>
          <strong>
            {currentLastFour
              ? `Key ending in ${currentLastFour}`
              : "No key connected"}
          </strong>
          <small>
            {currentLastFour
              ? "Encrypted and ready for your future agent turns."
              : `Add your own ${providerName} API key to prepare for agent sessions.`}
          </small>
        </div>
      </div>
      <label>
        <span>{providerName} API key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={PROVIDER_PLACEHOLDERS[provider]}
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
