import { reconcileLifecycle } from "@/lib/lifecycle";
import { logEvent, requestId } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const id = requestId(request);
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    logEvent("warn", "lifecycle.unauthorized", { requestId: id });
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    return Response.json(await reconcileLifecycle());
  } catch (error) {
    logEvent("error", "lifecycle.failed", {
      requestId: id,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json(
      { error: "Lifecycle reconciliation failed.", requestId: id },
      { status: 503 },
    );
  }
}
