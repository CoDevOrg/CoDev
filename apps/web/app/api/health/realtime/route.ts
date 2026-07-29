import { checkRealtimeConnection } from "@/lib/collaboration-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await checkRealtimeConnection();
    return Response.json({
      status: "ok",
      service: "codev-realtime",
    });
  } catch {
    return Response.json(
      {
        status: "error",
        service: "codev-realtime",
      },
      { status: 503 },
    );
  }
}
