"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How the Files pane handled a requested path. "confirming" means it asked
 * about unsaved edits; it reports "declined" if the member keeps them.
 */
export type FileRequestOutcome =
  | "opened"
  | "same"
  | "busy"
  | "confirming"
  | "declined";

export type FileRevealRange = {
  id: number;
  path: string;
  line: number;
  endLine?: number | undefined;
};

type PathRequest = { path: string; attempt: number };

const RETRY_MS = 300;
const MAX_RETRIES = 10;

/**
 * A file to open in the Files pane, and the lines to reveal once it is open.
 * The pane drops a request while it is opening or saving another file; the
 * request is then issued again a few times. A request the member declined
 * (the unsaved-changes prompt) is never repeated. The lines are revealed
 * once: reopening the file later shows it as the member left it.
 */
export function useWorkspaceFileRequest() {
  const [request, setRequestState] = useState<PathRequest | null>(null);
  const [range, setRange] = useState<FileRevealRange | null>(null);
  // The pane answers from its own effect, before this component's effects
  // run, so the request it answers is tracked here as it is set.
  const requestRef = useRef<PathRequest | null>(null);
  const nextId = useRef(0);
  const retry = useRef<number | undefined>(undefined);
  const setRequest = useCallback((next: PathRequest | null) => {
    requestRef.current = next;
    setRequestState(next);
  }, []);

  useEffect(() => () => window.clearTimeout(retry.current), []);

  const open = useCallback(
    (path: string, lines?: { line: number; endLine?: number } | null) => {
      window.clearTimeout(retry.current);
      nextId.current += 1;
      setRequest({ path, attempt: 0 });
      setRange(lines ? { id: nextId.current, path, ...lines } : null);
    },
    [setRequest],
  );

  const consumed = useCallback(
    (outcome?: FileRequestOutcome) => {
      const current = requestRef.current;
      setRequest(null);
      if (outcome === "declined") setRange(null);
      if (outcome !== "busy" || !current || current.attempt >= MAX_RETRIES)
        return;
      retry.current = window.setTimeout(
        () => setRequest({ ...current, attempt: current.attempt + 1 }),
        RETRY_MS,
      );
    },
    [setRequest],
  );

  const revealed = useCallback(
    (id: number) =>
      setRange((current) => (current?.id === id ? null : current)),
    [],
  );

  return { path: request?.path ?? null, range, open, consumed, revealed };
}
