import { mintCliAccessToken } from "@/lib/cli-auth";
import { apiError } from "@/lib/api";
import { resolveCredentialsSignIn } from "@/lib/credentials-auth";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const clientAddress =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const limit = await consumeRateLimit(
    clientAddress,
    "mobile-credentials-auth",
    20,
    3600,
  );
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    intent?: unknown;
    name?: unknown;
    email?: unknown;
    password?: unknown;
  } | null;
  if (!body) {
    return apiError(new Error("Invalid request body."), 400);
  }

  const user = await resolveCredentialsSignIn(body);
  if (!user) {
    return apiError(
      new Error("Invalid email/password, or that email is already in use."),
      401,
    );
  }

  const { token, expiresAt } = await mintCliAccessToken(user.id, "mobile");
  return Response.json({
    status: "connected",
    token,
    expiresAt: expiresAt.toISOString(),
  });
}
