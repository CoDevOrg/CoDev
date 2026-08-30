import { mintCliAccessToken } from "@/lib/cli-auth";
import { apiError } from "@/lib/api";
import { resolveCredentialsSignIn } from "@/lib/credentials-auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isEmailAllowlisted } from "@/lib/registration";

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

  // The invite flow needs a browser (it drops a signed grant cookie), so the
  // mobile app can only create an account for an allow-listed address. Invited
  // users do their first sign-up on the web, then sign in here.
  const user = await resolveCredentialsSignIn(body, {
    guardRegistration: (email) => isEmailAllowlisted(email),
  });
  if (!user) {
    return apiError(
      new Error(
        "Invalid email/password, that email is already in use, or you need a web invite first.",
      ),
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
