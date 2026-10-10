"use client";

import { useRef, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";

import type { Gen2SessionImportProvider } from "@codev/contracts";
import { Input } from "@/components/ui/input";
import {
  pickSessionFolder,
  scanLocalSessions,
  scanSelectedFolder,
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
 * Only the chosen session is uploaded. `access` is how the browser lets a
 * page read a folder: the folder picker, or a folder input as the fallback.
 */
export function SessionImportBrowser({
  provider,
  folder,
  access,
  disabled,
  onPick,
}: {
  provider: Gen2SessionImportProvider;
  folder: string;
  access: "picker" | "input";
  disabled: boolean;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sessions, setSessions] = useState<LocalSession[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  async function list(scan: () => Promise<LocalSession[]>) {
    setError("");
    setScanning(true);
    try {
      const found = await scan();
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

  async function browse() {
    if (access === "input") {
      inputRef.current?.click();
      return;
    }
    const directory = await pickSessionFolder(provider).catch(() => {
      setError("Couldn't open that folder. Choose it again.");
      return null;
    });
    if (directory) await list(() => scanLocalSessions(directory, provider));
  }

  // React has no prop for `webkitdirectory`, so it is set on the element.
  const folderInput =
    access === "input" ? (
      <input
        ref={(element) => {
          inputRef.current = element;
          element?.setAttribute("webkitdirectory", "");
        }}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length) {
            void list(() => scanSelectedFolder(files, provider));
          }
        }}
      />
    ) : null;

  const needle = query.trim().toLowerCase();
  const visible = (sessions ?? []).filter((session) =>
    `${session.title} ${session.branch ?? ""}`.toLowerCase().includes(needle),
  );

  if (!sessions) {
    return (
      <div className="gen2-session-import-browse">
        {folderInput}
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
      {folderInput}
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
