"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  gen2PreviewPortsResponseSchema,
  type Gen2PreviewPortsResponse,
} from "@codev/contracts";

import { boundedJsonRequest } from "@/lib/gen2/bounded-request";

const REQUEST_TIMEOUT_MS = 15_000;
/** How often a pane waiting for a dev server checks again. */
export const PREVIEW_PORT_POLL_MS = 2_000;

async function readPorts(workspaceId: string) {
  const { response, payload } = await boundedJsonRequest<unknown>(
    `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/preview/ports`,
    { cache: "no-store" },
    REQUEST_TIMEOUT_MS,
  );
  const parsed = gen2PreviewPortsResponseSchema.safeParse(payload);
  if (response.ok && parsed.success) return parsed.data;
  const error = (payload as { error?: unknown } | null)?.error;
  throw new Error(
    typeof error === "string" ? error : "Couldn’t check for dev servers.",
  );
}

/**
 * The guest's previewable dev servers: read when the pane becomes usable,
 * on demand (the port menu), and every two seconds while `poll` is on and
 * the page is visible. The server reads them without counting as activity.
 */
export function usePreviewPorts(
  workspaceId: string,
  enabled: boolean,
  poll: boolean,
) {
  const [ports, setPorts] = useState<Gen2PreviewPortsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    const request = readPorts(workspaceId)
      .then(
        (next) => {
          setPorts(next);
          setError("");
        },
        (caught: unknown) =>
          setError(
            caught instanceof Error && caught.message
              ? caught.message
              : "Couldn’t check for dev servers.",
          ),
      )
      .finally(() => {
        inFlight.current = null;
        setLoading(false);
      });
    inFlight.current = request;
    return request;
  }, [workspaceId]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [enabled, refresh]);

  // A guest without the preview proxy will not grow one while we wait.
  const settled = ports !== null && !ports.available && ports.reason !== "busy";
  useEffect(() => {
    if (!enabled || !poll || settled) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, PREVIEW_PORT_POLL_MS);
    return () => clearInterval(interval);
  }, [enabled, poll, settled, refresh]);

  return { ports: enabled ? ports : null, error, loading, refresh };
}
