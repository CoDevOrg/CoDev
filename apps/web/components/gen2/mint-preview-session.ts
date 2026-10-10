"use client";

import { gen2PreviewSessionResponseSchema } from "@codev/contracts";

import { boundedJsonRequest } from "@/lib/gen2/bounded-request";

export type PreviewTarget = { port: number; path: string };

const REQUEST_TIMEOUT_MS = 20_000;
const FAILED = "Couldn’t open the preview.";

/** A single-use session URL for one port; the guest turns it into a cookie. */
export async function mintPreviewSession(
  workspaceId: string,
  target: PreviewTarget,
) {
  // Edge error pages are HTML; their parse errors mean nothing to members.
  const reply = await boundedJsonRequest<unknown>(
    `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(target),
      cache: "no-store",
    },
    REQUEST_TIMEOUT_MS,
  ).catch(() => null);
  const parsed = gen2PreviewSessionResponseSchema.safeParse(reply?.payload);
  if (reply?.response.ok && parsed.success) return parsed.data.url;
  const error = (reply?.payload as { error?: unknown } | null | undefined)
    ?.error;
  throw new Error(typeof error === "string" ? error : FAILED);
}
