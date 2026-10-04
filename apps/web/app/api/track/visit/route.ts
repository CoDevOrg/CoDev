import { getApiUser } from "@/lib/http/api";
import { hashCallerAddress, recordPageView } from "@/lib/admin/page-views";

import {
  analyticsAllowed,
  analyticsPath,
  analyticsReferrer,
} from "@/lib/platform/privacy-preferences";

export const runtime = "nodejs";

type VisitPayload = {
  path?: unknown;
  referrer?: unknown;
};

/**
 * Fire-and-forget page-view beacon. The client posts `{ path }` on every route
 * change (see `components/landing/visit-tracker.tsx`). Auth is optional: marketing-page
 * hits from signed-out visitors are exactly what we want to count, so they are
 * stored with a null user id. Always returns 204 — the visitor must never see
 * an error from telemetry.
 */
export async function POST(request: Request) {
  const optedOut =
    request.headers.get("sec-gpc") === "1" ||
    request.headers.get("dnt") === "1";
  if (!analyticsAllowed(request.headers.get("cookie") ?? "", optedOut))
    return new Response(null, { status: 204 });
  try {
    const body = (await request.json()) as VisitPayload;
    const path = typeof body.path === "string" ? body.path : null;
    if (!path) {
      return new Response(null, { status: 204 });
    }

    const user = await getApiUser().catch(() => null);

    await recordPageView({
      path: analyticsPath(path),
      userId: user?.id ?? null,
      referrer: analyticsReferrer(
        typeof body.referrer === "string"
          ? body.referrer
          : request.headers.get("referer"),
      ),
      userAgent: request.headers.get("user-agent"),
      ipHash: hashCallerAddress(request),
    });
  } catch (error) {
    console.error("visit beacon failed", error);
  }

  return new Response(null, { status: 204 });
}
