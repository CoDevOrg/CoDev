"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateGen2WorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/gen2/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(name.trim() ? { name: name.trim() } : {}),
    });
    const payload = (await response.json()) as {
      workspace?: { id: string };
      error?: string;
    };
    if (!response.ok || !payload.workspace) {
      setError(payload.error ?? "The workspace could not be created.");
      setBusy(false);
      return;
    }
    router.push(`/gen2/${payload.workspace.id}`);
    router.refresh();
  }

  return (
    <form
      className="gen2-create"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <label className="gen2-field">
        <span>Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder="Workspace"
          autoComplete="off"
        />
      </label>
      <button className="primary-button" type="submit" disabled={busy}>
        {busy ? "Creating…" : "New workspace"}
      </button>
      {error ? (
        <p className="form-message error-copy" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
