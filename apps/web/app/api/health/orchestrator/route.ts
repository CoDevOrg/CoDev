import { NextResponse } from "next/server";

import { getHostState } from "@/lib/host";
import { checkOrchestratorConnection } from "@/lib/orchestrator";

export async function GET() {
  try {
    const hostState = await getHostState();
    if (hostState === "stopped" || hostState === "stopping") {
      return NextResponse.json({
        status: "ok",
        service: "codev-orchestrator",
        state: "sleeping",
      });
    }
    if (hostState === "pending") {
      return NextResponse.json({
        status: "ok",
        service: "codev-orchestrator",
        state: "starting",
      });
    }
    if (hostState !== "running") {
      throw new Error(`Unexpected host state: ${hostState}`);
    }
    await checkOrchestratorConnection();
    return NextResponse.json({
      status: "ok",
      service: "codev-orchestrator",
      state: "ready",
    });
  } catch (error) {
    console.error("Orchestrator health check failed.", error);
    return NextResponse.json(
      {
        status: "degraded",
        service: "codev-orchestrator",
      },
      { status: 503 },
    );
  }
}
