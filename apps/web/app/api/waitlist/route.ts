import { waitlistJoinInputSchema } from "@codev/contracts";
import { schema } from "@codev/db";

import { apiError } from "@/lib/api";
import { getDatabase } from "@/lib/database";
import { logEvent } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/rate-limit";
import { sendWaitlistConfirmationEmail } from "@/lib/waitlist-mail";

export async function POST(request: Request) {
  const clientAddress =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  const limit = await consumeRateLimit(clientAddress, "waitlist-join", 5, 3600);
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const parsed = waitlistJoinInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(new Error("Enter a valid email address."), 400);
  }

  const { email, name } = parsed.data;

  await getDatabase()
    .insert(schema.waitlistEntries)
    .values({ email, name: name ?? null })
    .onConflictDoNothing({ target: schema.waitlistEntries.email });

  logEvent("info", "waitlist.joined", { email });

  try {
    await sendWaitlistConfirmationEmail(email);
  } catch (error) {
    logEvent("warn", "waitlist.confirmation_email_failed", {
      email,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return Response.json({ joined: true }, { status: 201 });
}
