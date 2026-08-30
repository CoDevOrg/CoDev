import { getApiUser } from "@/lib/api";
import { hashCallerAddress, recordPageView } from "@/lib/page-views";

export const runtime = "nodejs";

type VisitPayload = {
  path?: unknown;
  referrer?: unknown;
};

/**
 * Fire-and-forget page-view beacon. The client posts `{ path }` on every route
 * change (see `components/visit-tracker.tsx`). Auth is optional: marketing-page
 * hits from signed-out visitors are exactly what we want to count, so they are
 * stored with a null user id. Always returns 204 — the visitor must never see
 * an error from telemetry.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VisitPayload;
    const path = typeof body.path === "string" ? body.path : null;
    if (!path) {
      return new Response(null, { status: 204 });
    }

    const user = await getApiUser().catch(() => null);

    await recordPageView({
      path,
      userId: user?.id ?? null,
      referrer:
        typeof body.referrer === "string"
          ? body.referrer
          : request.headers.get("referer"),
      userAgent: request.headers.get("user-agent"),
      ipHash: hashCallerAddress(request),
    });
  } catch (error) {
    console.error("visit beacon failed", error);
  }

  return new Response(null, { status: 204 });
}
