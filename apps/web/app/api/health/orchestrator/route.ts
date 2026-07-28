import { NextResponse } from "next/server";

import { checkOrchestratorConnection } from "@/lib/orchestrator";

export async function GET() {
  try {
    await checkOrchestratorConnection();
    return NextResponse.json({
      status: "ok",
      service: "codev-orchestrator",
    });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        service: "codev-orchestrator",
      },
      { status: 503 },
    );
  }
}
