"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BedrockRoleForm({
  currentRole,
  workspaceId,
}: {
  currentRole?: string | undefined;
  workspaceId?: string | undefined;
}) {
  const router = useRouter();
  const [roleArn, setRoleArn] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setMessage("");
    const endpoint = workspaceId
      ? `/api/workspaces/${workspaceId}/credentials`
      : "/api/settings/provider-credential";
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "bedrock",
        credentialType: "AWS_BEDROCK_ROLE",
        awsRoleArn: roleArn.trim(),
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    setSaving(false);
    if (!response.ok) {
      setMessage(payload?.error ?? "The Bedrock role could not be saved.");
      return;
    }
    setRoleArn("");
    setMessage("Bedrock role saved securely.");
    router.refresh();
  }

  async function remove() {
    setSaving(true);
    setMessage("");
    const endpoint = workspaceId
      ? `/api/workspaces/${workspaceId}/credentials?provider=bedrock`
      : "/api/settings/provider-credential?provider=bedrock";
    const response = await fetch(endpoint, { method: "DELETE" });
    setSaving(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setMessage(payload?.error ?? "The Bedrock role could not be removed.");
      return;
    }
    setMessage("Bedrock role removed.");
    router.refresh();
  }

  return (
    <div className="credential-form">
      <div className="credential-status">
        <span className={currentRole ? "dot-ready" : "dot-muted"} />
        <div>
          <strong>
            {currentRole ? "IAM role connected" : "No role connected"}
          </strong>
          <small>
            {workspaceId
              ? "Teammates use this role when they have no personal provider credential."
              : "CoDev assumes this role only for Bedrock agent requests."}
          </small>
        </div>
      </div>
      <label>
        <span>AWS IAM role ARN</span>
        <input
          type="text"
          value={roleArn}
          onChange={(event) => setRoleArn(event.target.value)}
          placeholder="arn:aws:iam::123456789012:role/CoDevBedrock"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="form-actions">
        <button
          className="primary-button"
          type="button"
          disabled={!roleArn.trim() || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : currentRole ? "Replace role" : "Save role"}
        </button>
        {currentRole ? (
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
