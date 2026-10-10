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
const FAILED = "Couldn’t check for dev servers.";

async function readPorts(workspaceId: string) {
  // Edge error pages are HTML; their parse errors mean nothing to members.
  const reply = await boundedJsonRequest<unknown>(
    `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/preview/ports`,
    { cache: "no-store" },
    REQUEST_TIMEOUT_MS,
  ).catch(() => null);
  const parsed = gen2PreviewPortsResponseSchema.safeParse(reply?.payload);
  if (reply?.response.ok && parsed.success) return parsed.data;
  const error = (reply?.payload as { error?: unknown } | null | undefined)
    ?.error;
  throw new Error(typeof error === "string" ? error : FAILED);
}

/** Not configured, or a guest that cannot serve previews: nothing to mint. */
export function previewsUnavailable(ports: Gen2PreviewPortsResponse | null) {
  return ports !== null && !ports.available && ports.reason !== "busy";
}

type Listing = {
  epoch: number;
  ports: Gen2PreviewPortsResponse | null;
  error: string;
};

/** The newest listing of the current `epoch`; answers to older ones lose. */
function useListing(workspaceId: string, epoch: number) {
  const [listing, setListing] = useState<Listing>({
    epoch,
    ports: null,
    error: "",
  });
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<{ epoch: number; request: Promise<void> } | null>(
    null,
  );
  const refresh = useCallback(() => {
    if (inFlight.current?.epoch === epoch) return inFlight.current.request;
    setLoading(true);
    const settle = (next: Partial<Listing>) =>
      setListing((previous) => {
        if (previous.epoch > epoch) return previous;
        const kept = previous.epoch === epoch ? previous.ports : null;
        return { ports: kept, error: "", ...next, epoch };
      });
    const request = readPorts(workspaceId)
      .then(
        (ports) => settle({ ports }),
        (caught: unknown) =>
          settle({ error: caught instanceof Error ? caught.message : FAILED }),
      )
      .finally(() => {
        if (inFlight.current?.request !== request) return;
        inFlight.current = null;
        setLoading(false);
      });
    inFlight.current = { epoch, request };
    return request;
  }, [workspaceId, epoch]);
  const current = listing.epoch === epoch ? listing : null;
  return {
    ports: current?.ports ?? null,
    error: current?.error ?? "",
    loading,
    refresh,
  };
}

/**
 * The guest's previewable dev servers: read when the pane becomes live, on
 * demand (the port menu), and every two seconds while `poll` is on and the
 * page is visible. The last listing outlives a hidden tab (the agent's
 * snapshot reports it) but not a disconnect, since a restarted guest serves
 * nothing until listed again. The server reads them without counting as
 * activity.
 */
export function usePreviewPorts(input: {
  workspaceId: string;
  usable: boolean;
  live: boolean;
  poll: boolean;
}) {
  const { workspaceId, usable, live, poll } = input;
  const scope = usable ? workspaceId : null;
  const [connection, setConnection] = useState({ scope, epoch: 0 });
  if (connection.scope !== scope)
    setConnection({ scope, epoch: connection.epoch + 1 });
  const listing = useListing(workspaceId, connection.epoch);
  const { ports, refresh } = listing;
  useEffect(() => {
    if (!live) return;
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [live, refresh]);

  // A guest without the preview proxy will not grow one while we wait.
  const settled = previewsUnavailable(ports);
  useEffect(() => {
    if (!live || !poll || settled) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, PREVIEW_PORT_POLL_MS);
    return () => clearInterval(interval);
  }, [live, poll, settled, refresh]);

  return usable ? listing : { ...listing, ports: null, error: "" };
}
