import { createCliDeviceAuthorization } from "@/lib/cli-auth";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const clientAddress =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const limit = await consumeRateLimit(
    clientAddress,
    "cli-device-auth",
    20,
    3600,
  );
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many CLI login attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }
  const authorization = await createCliDeviceAuthorization();
  const origin = new URL(request.url).origin;
  return Response.json({
    deviceCode: authorization.deviceCode,
    userCode: authorization.userCode,
    verificationUrl: `${origin}/cli/authorize`,
    expiresAt: authorization.expiresAt.toISOString(),
    intervalSeconds: 3,
  });
}
