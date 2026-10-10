"use client";

import { useEffect, useRef, useState } from "react";
import type { Gen2SupersetEntry } from "@codev/contracts";

import type { WorkspaceAgentSources } from "./workspace-controller";

export type ComposerFiles =
  | { status: "loading"; entries: null }
  | { status: "ready"; entries: Gen2SupersetEntry[] }
  | { status: "unavailable"; entries: null };

/**
 * The current worktree's files while a menu that lists them is open. The
 * shell caches the list, so reopening the menu costs nothing; it is null
 * when the guest cannot list them (an error, or too many files).
 */
export function useComposerFiles(
  sources: WorkspaceAgentSources | null,
  open: boolean,
) {
  const [files, setFiles] = useState<ComposerFiles & { worktree: string }>({
    status: "loading",
    entries: null,
    worktree: "",
  });
  const sourcesRef = useRef(sources);
  useEffect(() => {
    sourcesRef.current = sources;
  });
  const worktree = sources?.worktreeId ?? "";

  useEffect(() => {
    const current = sourcesRef.current;
    if (!open || !current) return;
    let live = true;
    current.listFiles().then(
      (entries) => {
        if (!live) return;
        setFiles(
          entries
            ? { status: "ready", entries, worktree }
            : { status: "unavailable", entries: null, worktree },
        );
      },
      () => {
        if (live) setFiles({ status: "unavailable", entries: null, worktree });
      },
    );
    return () => {
      live = false;
    };
  }, [open, worktree]);

  return files.worktree === worktree
    ? files
    : ({ status: "loading", entries: null } as const);
}
