"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  gen2RemoteBranchListSchema,
  type Gen2RemoteBranchList,
} from "@codev/contracts";

/** Reopening the menu within this window reuses the last list. */
const FRESH_MS = 30_000;

type RemoteBranches =
  | { status: "idle" | "loading"; list: Gen2RemoteBranchList | null }
  | { status: "ready"; list: Gen2RemoteBranchList }
  | { status: "error"; list: Gen2RemoteBranchList | null; error: string };

/** The repository's GitHub branches, loaded when the branch menu opens. */
export function useRemoteBranches(workspaceId: string, open: boolean) {
  const [state, setState] = useState<RemoteBranches>({
    status: "idle",
    list: null,
  });
  const loadedAt = useRef(0);

  const load = useCallback(async () => {
    setState((current) => ({ status: "loading", list: current.list }));
    try {
      const response = await fetch(
        `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/branches`,
        { cache: "no-store", signal: AbortSignal.timeout(20_000) },
      );
      const payload: unknown = await response.json().catch(() => null);
      const parsed = gen2RemoteBranchListSchema.safeParse(payload);
      if (!response.ok || !parsed.success) {
        throw new Error(
          (payload as { error?: string } | null)?.error ??
            "Couldn’t load branches from GitHub.",
        );
      }
      loadedAt.current = Date.now();
      setState({ status: "ready", list: parsed.data });
    } catch (error) {
      setState((current) => ({
        status: "error",
        list: current.list,
        error:
          error instanceof Error && error.name !== "TimeoutError"
            ? error.message
            : "GitHub took too long to answer.",
      }));
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open || Date.now() - loadedAt.current < FRESH_MS) return;
    const timeout = setTimeout(() => void load(), 0);
    return () => clearTimeout(timeout);
  }, [open, load]);

  return { ...state, reload: load };
}
