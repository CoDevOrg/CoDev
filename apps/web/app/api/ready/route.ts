import { getReadiness } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await getReadiness();
  return Response.json(readiness, {
    status: readiness.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
