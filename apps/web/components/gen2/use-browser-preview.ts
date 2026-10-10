"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  gen2PreviewSessionRequestSchema,
  type Gen2PreviewPortsResponse,
} from "@codev/contracts";

import { mintPreviewSession, type PreviewTarget } from "./mint-preview-session";
import { previewsUnavailable, usePreviewPorts } from "./use-preview-ports";

export type PreviewPhase =
  | "idle"
  | "waiting"
  | "missing"
  | "opening"
  | "open"
  | "error";

type BrowserPreviewInput = {
  workspaceId: string;
  visible: boolean;
  canEdit: boolean;
  connected: boolean;
  request: { id: string; port: number; path: string } | null;
};

/** A requested port gets this long to start listening before we say so. */
export const PREVIEW_WAIT_MS = 60_000;

const storageKey = (workspaceId: string) => `codev-gen2-preview:${workspaceId}`;

function readStoredTarget(workspaceId: string): PreviewTarget | null {
  try {
    const stored = sessionStorage.getItem(storageKey(workspaceId));
    const parsed = gen2PreviewSessionRequestSchema.safeParse(
      JSON.parse(stored ?? "null"),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function storeTarget(workspaceId: string, target: PreviewTarget) {
  try {
    sessionStorage.setItem(storageKey(workspaceId), JSON.stringify(target));
  } catch {
    // Storage may be unavailable; the address is only a convenience.
  }
}

function canOpen(ports: Gen2PreviewPortsResponse | null, port: number) {
  // A busy guest cannot list ports; its proxy still checks the port itself.
  return Boolean(
    ports &&
    (ports.reason === "busy" ||
      ports.ports.some((entry) => entry.port === port)),
  );
}

type PreviewState = {
  target: PreviewTarget | null;
  phase: PreviewPhase;
  url: string | null;
  error: string;
  /** The session request whose answer still counts; 0 when none does. */
  attempt: number;
};

type PreviewAction =
  | { type: "open"; target: PreviewTarget }
  | { type: "cancel" }
  | { type: "timeout" }
  | { type: "minting"; attempt: number }
  | { type: "minted"; attempt: number; url: string }
  | { type: "failed"; attempt: number; error: string };

const INITIAL: PreviewState = {
  target: null,
  phase: "idle",
  url: null,
  error: "",
  attempt: 0,
};

function reducePreview(
  state: PreviewState,
  action: PreviewAction,
): PreviewState {
  switch (action.type) {
    case "open":
      return { ...INITIAL, target: action.target, phase: "waiting" };
    case "cancel":
      return INITIAL;
    case "timeout":
      return state.phase === "waiting" ? { ...state, phase: "missing" } : state;
    case "minting":
      return {
        ...state,
        phase: "opening",
        error: "",
        attempt: action.attempt,
      };
    default:
      if (action.attempt !== state.attempt) return state;
      return action.type === "minted"
        ? { ...state, phase: "open", url: action.url, attempt: 0 }
        : {
            ...state,
            phase: "error",
            error: action.error,
            attempt: 0,
          };
  }
}

/** Mints as soon as the requested port listens; gives up after a minute. */
function useWaitForPort(input: {
  state: PreviewState;
  usable: boolean;
  live: boolean;
  ports: Gen2PreviewPortsResponse | null;
  mint(target: PreviewTarget): Promise<void>;
  dispatch(action: PreviewAction): void;
}) {
  const { state, usable, live, ports, mint, dispatch } = input;
  const { phase, target } = state;
  useEffect(() => {
    if (phase !== "waiting" || !usable || !target) return;
    if (!canOpen(ports, target.port)) return;
    const timer = setTimeout(() => void mint(target), 0);
    return () => clearTimeout(timer);
  }, [phase, usable, target, ports, mint]);
  useEffect(() => {
    if (phase !== "waiting" || !live) return;
    const timer = setTimeout(
      () => dispatch({ type: "timeout" }),
      PREVIEW_WAIT_MS,
    );
    return () => clearTimeout(timer);
  }, [phase, live, dispatch]);
}

/**
 * The Browser tab's state machine: a member, agent, or slash command asks
 * for a port; the pane waits until that port is listening, then mints a
 * session for it. Sessions are minted again after a reconnect, since a
 * restarted workspace serves previews from a new generation's hosts.
 */
export function useBrowserPreview(input: BrowserPreviewInput) {
  const { workspaceId, visible } = input;
  const usable = input.connected && input.canEdit;
  const live = usable && visible;
  const [state, dispatch] = useReducer(reducePreview, INITIAL);
  const attempts = useRef(0);
  const ports = usePreviewPorts({
    workspaceId,
    usable,
    live,
    poll: state.phase === "waiting" && visible,
  });
  const blocked = previewsUnavailable(ports.ports);
  const mint = useCallback(
    async (target: PreviewTarget) => {
      if (blocked) return;
      const attempt = ++attempts.current;
      dispatch({ type: "minting", attempt });
      try {
        const url = await mintPreviewSession(workspaceId, target);
        dispatch({ type: "minted", attempt, url });
      } catch (caught) {
        const error =
          caught instanceof Error && caught.message
            ? caught.message
            : "Couldn’t open the preview.";
        dispatch({ type: "failed", attempt, error });
      }
    },
    [workspaceId, blocked],
  );
  const open = useCallback(
    (target: PreviewTarget) => {
      dispatch({ type: "open", target });
      storeTarget(workspaceId, target);
    },
    [workspaceId],
  );
  const cancel = useCallback(() => dispatch({ type: "cancel" }), []);
  usePreviewTriggers({ ...input, usable, live, target: state.target, open });
  useWaitForPort({ state, usable, live, ports: ports.ports, mint, dispatch });
  const { target, phase, url, error } = state;
  return { target, phase, url, error, ports, blocked, open, mint, cancel };
}

/** Opens what was asked for: a request, the last address, or after a reconnect. */
function usePreviewTriggers(input: {
  workspaceId: string;
  request: BrowserPreviewInput["request"];
  usable: boolean;
  live: boolean;
  target: PreviewTarget | null;
  open(target: PreviewTarget): void;
}) {
  const { workspaceId, request, usable, live, target, open } = input;
  const requestId = request?.id ?? null;
  const requestPort = request?.port ?? 0;
  const requestPath = request?.path ?? "/";
  useEffect(() => {
    if (requestId === null) return;
    const timer = setTimeout(
      () => open({ port: requestPort, path: requestPath }),
      0,
    );
    return () => clearTimeout(timer);
  }, [requestId, requestPort, requestPath, open]);

  const restored = useRef(false);
  const hasTarget = target !== null;
  useEffect(() => {
    if (!live || restored.current) return;
    restored.current = true;
    const stored = readStoredTarget(workspaceId);
    if (!stored || hasTarget || requestId !== null) return;
    const timer = setTimeout(() => open(stored), 0);
    return () => clearTimeout(timer);
  }, [live, workspaceId, hasTarget, requestId, open]);

  const wasUsable = useRef(usable);
  useEffect(() => {
    const reconnected = usable && !wasUsable.current;
    wasUsable.current = usable;
    if (!reconnected || !target) return;
    const timer = setTimeout(() => open(target), 0);
    return () => clearTimeout(timer);
  }, [usable, target, open]);
}
