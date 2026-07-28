import { NextResponse } from "next/server";

import { checkDatabaseConnection } from "@/lib/database";

export const runtime = "nodejs";

export async function GET() {
  try {
    await checkDatabaseConnection();

    return NextResponse.json({
      status: "ok",
      service: "codev-database",
    });
  } catch {
    return NextResponse.json(
      {
        status: "error",
        service: "codev-database",
      },
      { status: 503 },
    );
  }
}
