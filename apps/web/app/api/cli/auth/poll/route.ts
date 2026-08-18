import {
  cliAuthErrorResponse,
  exchangeCliDeviceAuthorization,
} from "@/lib/cli-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as { deviceCode?: unknown };
    if (typeof input.deviceCode !== "string") {
      return Response.json(
        { error: "Device code is required." },
        { status: 400 },
      );
    }
    const result = await exchangeCliDeviceAuthorization(input.deviceCode);
    return result
      ? Response.json({
          status: "connected",
          token: result.token,
          expiresAt: result.expiresAt.toISOString(),
        })
      : Response.json({ status: "pending" }, { status: 202 });
  } catch (error) {
    return cliAuthErrorResponse(error);
  }
}
