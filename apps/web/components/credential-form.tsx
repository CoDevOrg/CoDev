"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CredentialForm({
  currentLastFour,
}: {
  currentLastFour: string | undefined;
}) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/settings/openai-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "The key could not be saved.");
      setSaving(false);
      return;
    }
    setApiKey("");
    setMessage("OpenAI key saved securely.");
    setSaving(false);
    router.refresh();
  }

  async function remove() {
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/settings/openai-key", {
      method: "DELETE",
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setMessage(payload.error ?? "The key could not be removed.");
    } else {
      setMessage("OpenAI key removed.");
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
              : "Add your own OpenAI API key to prepare for agent sessions."}
          </small>
        </div>
      </div>
      <label>
        <span>OpenAI API key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="sk-…"
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
