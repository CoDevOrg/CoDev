import { createHash } from "node:crypto";

import { accessRequestInputSchema } from "@codev/contracts";
import { schema } from "@codev/db";
import { and, eq, gt, sql } from "drizzle-orm";

import {
  notifyTeamOfAccessRequest,
  sendAccessRequestReceipt,
} from "@/lib/access-request-mail";
import { getDatabase } from "@/lib/database";
import { logEvent } from "@/lib/observability";

/** How many requests one network address may file per hour. */
const MAX_REQUESTS_PER_IP_PER_HOUR = 5;

/**
 * Anonymous callers have no user id to key a rate limit on, and the Redis
 * limiter fails closed when it is not provisioned — which would silently break
 * the only signup path on the marketing site. Throttle on a salted digest of
 * the caller's address using the table we are already writing to instead.
 */
function hashCallerAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const address =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim();
  if (!address) return null;
  const salt = process.env.AUTH_SECRET ?? "codev-access-request";
  return createHash("sha256").update(`${salt}:${address}`).digest("hex");
}

export async function POST(request: Request) {
  const parsed = accessRequestInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Add your name and a valid email address." },
      { status: 400 },
    );
  }

  const { name, email, githubLogin, persona, building, referrer } = parsed.data;
  const database = getDatabase();
  const ipHash = hashCallerAddress(request);

  if (ipHash) {
    const [recent] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.accessRequests)
      .where(
        and(
          eq(schema.accessRequests.ipHash, ipHash),
          gt(
            schema.accessRequests.createdAt,
            new Date(Date.now() - 60 * 60 * 1_000),
          ),
        ),
      );
    if ((recent?.count ?? 0) >= MAX_REQUESTS_PER_IP_PER_HOUR) {
      return Response.json(
        { error: "Too many requests. Try again a little later." },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
  }

  // A repeat submission is a person checking that it worked, not an error.
  // Refresh what they told us and answer with the same success shape.
  const [record] = await database
    .insert(schema.accessRequests)
    .values({
      email,
      name,
      githubLogin: githubLogin ?? null,
      persona: persona ?? null,
      building: building ?? null,
      referrer: referrer ?? null,
      ipHash,
    })
    .onConflictDoUpdate({
      target: schema.accessRequests.email,
      set: {
        name,
        githubLogin: githubLogin ?? null,
        persona: persona ?? null,
        building: building ?? null,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: schema.accessRequests.id,
      createdAt: schema.accessRequests.createdAt,
      updatedAt: schema.accessRequests.updatedAt,
    });

  if (!record) {
    return Response.json(
      { error: "Your request could not be saved. Please try again." },
      { status: 500 },
    );
  }

  const isNew = record.createdAt.getTime() === record.updatedAt.getTime();

  // Email delivery must never turn a saved request into a failed one.
  try {
    await sendAccessRequestReceipt({ email, name });
    if (isNew) {
      await notifyTeamOfAccessRequest({
        email,
        name,
        githubLogin,
        persona,
        building,
      });
    }
  } catch (error) {
    logEvent("error", "access_request.email_failed", {
      accessRequestId: record.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  logEvent("info", "access_request.submitted", {
    accessRequestId: record.id,
    persona: persona ?? null,
    hasGithub: Boolean(githubLogin),
    isNew,
  });

  return Response.json(
    { id: record.id, alreadyRequested: !isNew },
    { status: isNew ? 201 : 200 },
  );
}
