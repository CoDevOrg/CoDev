"use client";

import { useEffect, useRef, useState } from "react";
import { gen2PreviewSessionResponseSchema } from "@codev/contracts";

import { boundedJsonRequest } from "@/lib/gen2/bounded-request";

export type PreviewTarget = { port: number; path: string };

const REQUEST_TIMEOUT_MS = 20_000;
/** Guest session cookies last five minutes; refresh a minute early. */
const REFRESH_MS = 4 * 60_000;
const RETRY_MS = 60_000;
const CHECK_MS = 30_000;

/** A single-use session URL for one port; the guest turns it into a cookie. */
export async function mintPreviewSession(
  workspaceId: string,
  target: PreviewTarget,
) {
  const { response, payload } = await boundedJsonRequest<unknown>(
    `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(target),
      cache: "no-store",
    },
    REQUEST_TIMEOUT_MS,
  );
  const parsed = gen2PreviewSessionResponseSchema.safeParse(payload);
  if (response.ok && parsed.success) return parsed.data.url;
  const error = (payload as { error?: unknown } | null)?.error;
  throw new Error(
    typeof error === "string" ? error : "Couldn’t open the preview.",
  );
}

function isProxySession(url: string | null) {
  try {
    return url !== null && new URL(url).pathname === "/__codev/preview/session";
  } catch {
    return false;
  }
}

/**
 * Keeps an open preview's session alive while the pane is visible: about
 * every four minutes, a fresh session URL loads in a hidden frame on the
 * same host, which shares the visible frame's cookie partition. Local
 * direct previews have no session to refresh.
 */
export function usePreviewSessionRefresh(
  workspaceId: string,
  port: number | null,
  url: string | null,
  active: boolean,
) {
  const [refreshUrl, setRefreshUrl] = useState<string | null>(null);
  const refreshedAt = useRef(0);
  const proxied = isProxySession(url);

  useEffect(() => {
    refreshedAt.current = Date.now();
  }, [url]);

  useEffect(() => {
    if (!active || !proxied || port === null) return;
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - refreshedAt.current < REFRESH_MS) return;
      refreshedAt.current = Date.now();
      try {
        const next = await mintPreviewSession(workspaceId, { port, path: "/" });
        if (!cancelled) setRefreshUrl(next);
      } catch {
        refreshedAt.current = Date.now() - REFRESH_MS + RETRY_MS;
      }
    };
    const run = () => void check();
    const initial = setTimeout(run, 0);
    const interval = setInterval(run, CHECK_MS);
    document.addEventListener("visibilitychange", run);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", run);
    };
  }, [workspaceId, port, proxied, active]);

  return { refreshUrl, refreshed: () => setRefreshUrl(null) };
}
