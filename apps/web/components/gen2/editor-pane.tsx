"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Gen2File } from "@codev/contracts";

import type { Gen2EditorHandle } from "./code-editor";

// CodeMirror builds a real DOM on construction, so it is loaded in the
// browser only and never enters the route's first-load bundle.
const Gen2CodeEditor = dynamic(
  () => import("./code-editor").then((module) => module.Gen2CodeEditor),
  { ssr: false, loading: () => <div className="gen2-editor-skeleton" /> },
);

type Conflict = { currentRevision: string } | null;

export function Gen2EditorPane({
  workspaceId,
  file,
  agentRunning,
  onSaved,
}: {
  workspaceId: string;
  file: Gen2File | null;
  agentRunning: boolean;
  onSaved: () => void;
}) {
  const handleRef = useRef<Gen2EditorHandle | null>(null);
  // `baseline` is the text at `revision` -- what the machine had when this
  // buffer was loaded or last saved. Dirtiness is draft-vs-baseline, not
  // draft-vs-latest-fetch, so emptying a file still counts as an edit.
  const [draft, setDraft] = useState("");
  const [baseline, setBaseline] = useState("");
  const [revision, setRevision] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<Conflict>(null);
  const [refreshed, setRefreshed] = useState(false);
  const dirty = file !== null && draft !== baseline;

  function adopt(next: Gen2File) {
    setDraft(next.contents);
    setBaseline(next.contents);
    setRevision(next.revision);
    setConflict(null);
    handleRef.current?.replaceDoc(next.contents);
  }

  // A new revision of the open file arrived -- either this member saved, or
  // Codex edited it on the shared machine. Take it silently when the buffer
  // is clean; never overwrite unsaved work.
  useEffect(() => {
    if (!file || file.revision === revision) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError("");
    if (dirty) {
      setConflict({ currentRevision: file.revision });
      return;
    }
    const isReplacement = revision !== "";
    adopt(file);
    if (!isReplacement) return;
    setRefreshed(true);
    const timer = window.setTimeout(() => setRefreshed(false), 3_000);
    return () => window.clearTimeout(timer);
    // `dirty`/`revision` are read, not tracked: this must run when a new file
    // object arrives, not when the member types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  async function save() {
    if (!file || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/gen2/workspaces/${workspaceId}/files`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: file.path,
            contents: draft,
            expectedRevision: revision,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        revision?: string;
        error?: string;
        currentRevision?: string;
      };
      if (response.status === 409 && payload.currentRevision) {
        setConflict({ currentRevision: payload.currentRevision });
        return;
      }
      if (!response.ok || !payload.revision) {
        setError(payload.error ?? "That file could not be saved.");
        return;
      }
      setBaseline(draft);
      setRevision(payload.revision);
      setConflict(null);
      onSaved();
    } catch {
      setError("Couldn't reach CoDev. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function takeTheirs() {
    if (file) adopt(file);
  }

  if (!file) {
    return (
      <div className="gen2-editor-empty">
        <p>Select a file to open it.</p>
        <p className="gen2-wb-hint">
          You and Codex are editing the same machine.
        </p>
      </div>
    );
  }

  return (
    <div className="gen2-editor">
      <header className="gen2-editor-bar">
        <span className="gen2-editor-path" title={file.path}>
          {file.path}
          {dirty ? (
            <span className="gen2-editor-dirty" aria-label="Unsaved changes" />
          ) : null}
        </span>
        {refreshed ? (
          <span className="gen2-editor-flash" role="status">
            Updated by Codex
          </span>
        ) : null}
        <button
          type="button"
          className="gen2-wb-button"
          onClick={() => void save()}
          disabled={saving || agentRunning || (!dirty && !conflict)}
          title={
            agentRunning
              ? "Codex is working on this machine"
              : "Save to the workspace machine"
          }
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      {conflict ? (
        <div className="gen2-editor-conflict" role="alert">
          <span>This file changed on the machine.</span>
          <button
            type="button"
            className="gen2-wb-button"
            onClick={() => {
              // Adopt their revision without their text, so the next save
              // overwrites deliberately rather than failing again.
              setRevision(conflict.currentRevision);
              setConflict(null);
            }}
          >
            Keep mine
          </button>
          <button type="button" className="gen2-wb-button" onClick={takeTheirs}>
            Take theirs
          </button>
        </div>
      ) : null}

      {agentRunning ? (
        <p className="gen2-wb-banner" role="status">
          Codex is working on this machine — saving is paused.
        </p>
      ) : null}

      {error ? (
        <p className="gen2-wb-banner gen2-wb-banner-error" role="alert">
          {error}
        </p>
      ) : null}

      <Gen2CodeEditor
        key={file.path}
        path={file.path}
        initialDoc={file.contents}
        readOnly={agentRunning}
        onChange={setDraft}
        onSave={() => void save()}
        handleRef={handleRef}
      />
    </div>
  );
}
