"use client";

import { useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";

import type { Gen2SessionImportProvider } from "@codev/contracts";
import { Input } from "@/components/ui/input";
import {
  pickSessionFolder,
  scanLocalSessions,
  type LocalSession,
} from "@/lib/gen2/session-import-scan";

import { WorkspaceButton } from "./workspace-button";

function describeSession(session: LocalSession) {
  const when = new Date(session.modifiedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const kb = session.file.size / 1024;
  const size =
    kb < 1024
      ? `${Math.max(1, Math.round(kb))} KB`
      : `${(kb / 1024).toFixed(1)} MB`;
  return [session.branch, when, size].filter(Boolean).join(" · ");
}

/**
 * Lists the sessions in the agent's folder once the member grants it, so
 * they pick a conversation by name instead of hunting for a dated file.
 * Only the chosen session is uploaded.
 */
export function SessionImportBrowser({
  provider,
  folder,
  disabled,
  onPick,
}: {
  provider: Gen2SessionImportProvider;
  folder: string;
  disabled: boolean;
  onPick: (file: File) => void;
}) {
  const [sessions, setSessions] = useState<LocalSession[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  async function browse() {
    setError("");
    try {
      const directory = await pickSessionFolder(provider);
      if (!directory) return;
      setScanning(true);
      const found = await scanLocalSessions(directory, provider);
      if (!found.length) {
        setError(`No sessions found there. Choose ${folder}.`);
      }
      setSessions(found.length ? found : null);
    } catch {
      setError("Couldn't read that folder. Choose it again.");
    } finally {
      setScanning(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = (sessions ?? []).filter((session) =>
    `${session.title} ${session.branch ?? ""}`.toLowerCase().includes(needle),
  );

  if (!sessions) {
    return (
      <div className="gen2-session-import-browse">
        <WorkspaceButton
          tone="secondary"
          disabled={disabled || scanning}
          onClick={() => void browse()}
        >
          {scanning ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <FolderOpen aria-hidden="true" />
          )}
          {scanning ? "Reading sessions…" : `Choose ${folder}`}
        </WorkspaceButton>
        {error ? (
          <p className="gen2-session-import-browse-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="gen2-session-import-browse">
      <div className="gen2-session-import-browse-bar">
        <Input
          value={query}
          placeholder="Search sessions"
          aria-label="Search sessions"
          onChange={(event) => setQuery(event.target.value)}
        />
        <WorkspaceButton disabled={disabled} onClick={() => void browse()}>
          Change folder
        </WorkspaceButton>
      </div>
      <ul className="gen2-session-import-list" aria-label="Local sessions">
        {visible.map((session) => (
          <li key={`${session.file.name}:${session.modifiedAt}`}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(session.file)}
            >
              <span className="gen2-session-import-list-title">
                {session.title}
              </span>
              <span className="gen2-session-import-list-meta">
                {describeSession(session)}
              </span>
            </button>
          </li>
        ))}
        {visible.length === 0 ? (
          <li className="gen2-session-import-list-empty">
            No sessions match “{query}”.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
