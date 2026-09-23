"use client";

import { useEffect, useState } from "react";
import type {
  Gen2AgentExecutionPolicy,
  Gen2WorkspaceCapabilities,
} from "@codev/contracts";
import { CircleAlert, LoaderCircle } from "lucide-react";

type PolicyResponse = {
  policy?: Gen2AgentExecutionPolicy;
  error?: string;
};

export function Gen2AgentExecutionPolicySection({
  workspaceId,
  capabilities,
}: {
  workspaceId: string;
  capabilities: Gen2WorkspaceCapabilities;
}) {
  const [policy, setPolicy] = useState<Gen2AgentExecutionPolicy | null>(null);
  const [draft, setDraft] = useState<Gen2AgentExecutionPolicy | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const canManage = capabilities["workspace.managePolicy"];

  useEffect(() => {
    let active = true;
    fetch(`/api/gen2/workspaces/${workspaceId}/policy`)
      .then(async (response) => {
        const payload = (await response
          .json()
          .catch(() => ({}))) as PolicyResponse;
        if (!response.ok || !payload.policy) {
          throw new Error(payload.error ?? "Could not load the agent policy.");
        }
        if (!active) return;
        setPolicy(payload.policy);
        setDraft(payload.policy);
        setError("");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load the agent policy.",
        );
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  async function save() {
    if (!draft || !canManage || saving) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(
        `/api/gen2/workspaces/${workspaceId}/policy`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      const payload = (await response
        .json()
        .catch(() => ({}))) as PolicyResponse;
      if (!response.ok || !payload.policy) {
        throw new Error(payload.error ?? "Could not save the agent policy.");
      }
      setPolicy(payload.policy);
      setDraft(payload.policy);
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the agent policy.",
      );
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    policy !== null &&
    draft !== null &&
    policy.allowFileChanges !== draft.allowFileChanges;

  return (
    <section
      aria-labelledby="gen2-agent-policy-title"
      className="gen2-agent-policy"
    >
      <div className="gen2-agent-policy-heading">
        <div>
          <h3 id="gen2-agent-policy-title">What the agent can do</h3>
          <p>
            Workspace-wide limits for new agent turns. Your workspace role still
            controls who can run agents and use workspace tools.
          </p>
        </div>
        {policy ? (
          <span className="gen2-agent-policy-state">
            {policy.allowFileChanges ? "File changes allowed" : "Read-only"}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="gen2-agent-policy-error" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {!policy || !draft ? (
        <p className="gen2-agent-policy-loading" role="status" aria-busy="true">
          <LoaderCircle aria-hidden="true" size={16} /> Loading policy…
        </p>
      ) : (
        <>
          <fieldset
            className="gen2-agent-policy-control"
            disabled={!canManage || saving}
          >
            <label>
              <input
                checked={draft.allowFileChanges}
                onChange={(event) => {
                  setDraft({ allowFileChanges: event.target.checked });
                  setSaved(false);
                }}
                type="checkbox"
              />
              <span>Allow file changes</span>
            </label>
            <p>
              {draft.allowFileChanges
                ? "Codex runs with the workspace-write sandbox and can edit files during a new turn."
                : "Codex runs with a read-only sandbox. Existing running turns keep their original sandbox."}
            </p>
          </fieldset>

          <p className="gen2-agent-policy-fixed" role="note">
            Repository access and shell-tool use are fixed properties of the
            current Gen 2 runtime, not controls: the runtime cannot yet enforce
            a truthful toggle for either.
          </p>

          {canManage ? (
            <div className="gen2-agent-policy-actions">
              <button
                disabled={!dirty || saving}
                onClick={() => void save()}
                type="button"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
              <span aria-live="polite" role="status">
                {saved ? "Saved" : ""}
              </span>
            </div>
          ) : (
            <p className="gen2-agent-policy-readonly" role="note">
              Only members with the workspace.managePolicy capability can change
              this policy.
            </p>
          )}
        </>
      )}
    </section>
  );
}
