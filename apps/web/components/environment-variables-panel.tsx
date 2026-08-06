"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import type { EnvironmentVariable } from "@codev/contracts";

function maskedValue(lastFour: string | null) {
  if (!lastFour) return "••••••••";
  return `••••${lastFour}`;
}

export function EnvironmentVariablesPanel({
  initialVariables,
}: {
  initialVariables: EnvironmentVariable[];
}) {
  const router = useRouter();
  const [variables, setVariables] = useState(initialVariables);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "warning";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  function refreshList(next: EnvironmentVariable[]) {
    setVariables(next);
    router.refresh();
  }

  async function addVariable() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/settings/environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, value }),
    });
    const payload = (await response.json()) as {
      variable?: EnvironmentVariable;
      error?: string;
    };
    if (!response.ok || !payload.variable) {
      setMessage({
        tone: "warning",
        text: payload.error ?? "Could not save the variable.",
      });
      setBusy(false);
      return;
    }
    refreshList(
      [...variables, payload.variable].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
    setName("");
    setValue("");
    setShowAdd(false);
    setMessage({ tone: "success", text: `${payload.variable.name} saved.` });
    setBusy(false);
  }

  async function saveEdit(variableId: string) {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/settings/environment/${variableId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: editValue }),
    });
    const payload = (await response.json()) as {
      variable?: EnvironmentVariable;
      error?: string;
    };
    if (!response.ok || !payload.variable) {
      setMessage({
        tone: "warning",
        text: payload.error ?? "Could not update the variable.",
      });
      setBusy(false);
      return;
    }
    refreshList(
      variables.map((variable) =>
        variable.id === variableId ? payload.variable! : variable,
      ),
    );
    setEditingId(null);
    setEditValue("");
    setMessage({ tone: "success", text: `${payload.variable.name} updated.` });
    setBusy(false);
  }

  async function removeVariable(variable: EnvironmentVariable) {
    if (!window.confirm(`Delete ${variable.name}?`)) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/settings/environment/${variable.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setMessage({
        tone: "warning",
        text: payload?.error ?? "Could not delete the variable.",
      });
      setBusy(false);
      return;
    }
    refreshList(variables.filter((item) => item.id !== variable.id));
    setMessage({ tone: "success", text: `${variable.name} deleted.` });
    setBusy(false);
  }

  return (
    <div className="env-vars-panel">
      <div className="env-vars-toolbar">
        <p className="settings-muted-copy">
          Values are encrypted at rest and never shown again after you save. Use
          them like a personal <code>.env</code> for CoDev workflows.
        </p>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            setShowAdd((current) => !current);
            setMessage(null);
          }}
          type="button"
        >
          <Plus aria-hidden="true" className="env-vars-button-icon" />
          {showAdd ? "Cancel" : "Add"}
        </button>
      </div>

      {showAdd ? (
        <div className="env-vars-editor">
          <label>
            <span>Key</span>
            <input
              autoComplete="off"
              onChange={(event) => setName(event.target.value.toUpperCase())}
              placeholder="DATABASE_URL"
              spellCheck={false}
              value={name}
            />
          </label>
          <label>
            <span>Value</span>
            <input
              autoComplete="off"
              onChange={(event) => setValue(event.target.value)}
              placeholder="Sensitive value"
              spellCheck={false}
              type="password"
              value={value}
            />
          </label>
          <div className="form-actions">
            <button
              className="primary-button"
              disabled={busy || !name.trim() || !value}
              onClick={() => void addVariable()}
              type="button"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : null}

      {variables.length === 0 && !showAdd ? (
        <div className="env-vars-empty">
          <strong>No environment variables yet</strong>
          <p>Add keys your agents and sandboxes should be able to use later.</p>
        </div>
      ) : (
        <ul className="env-vars-list">
          {variables.map((variable) => {
            const isEditing = editingId === variable.id;
            return (
              <li className="env-vars-row" key={variable.id}>
                <div className="env-vars-row-copy">
                  <code>{variable.name}</code>
                  {isEditing ? (
                    <input
                      aria-label={`New value for ${variable.name}`}
                      autoComplete="off"
                      className="env-vars-edit-input"
                      onChange={(event) => setEditValue(event.target.value)}
                      placeholder="Enter a new value"
                      spellCheck={false}
                      type="password"
                      value={editValue}
                    />
                  ) : (
                    <span className="env-vars-masked">
                      {maskedValue(variable.lastFour)}
                    </span>
                  )}
                </div>
                <div className="env-vars-row-actions">
                  {isEditing ? (
                    <>
                      <button
                        className="secondary-button"
                        disabled={busy || !editValue}
                        onClick={() => void saveEdit(variable.id)}
                        type="button"
                      >
                        Save
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(null);
                          setEditValue("");
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        aria-label={`Edit ${variable.name}`}
                        className="icon-button"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(variable.id);
                          setEditValue("");
                          setMessage(null);
                        }}
                        type="button"
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`Delete ${variable.name}`}
                        className="icon-button"
                        disabled={busy}
                        onClick={() => void removeVariable(variable)}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

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
