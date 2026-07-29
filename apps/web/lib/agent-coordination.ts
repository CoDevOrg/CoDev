import "server-only";

import { randomUUID } from "node:crypto";

import {
  coordinationMessageInputSchema,
  createPathClaimSchema,
  type CoordinationMessageInput,
} from "@codev/contracts";
import { schema } from "@codev/db";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";

import { getDatabase } from "./database";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DatabaseExecutor = Database | Transaction;

export class CoordinationConflictError extends Error {
  readonly status = 409;

  constructor(
    message: string,
    readonly claimId?: string,
  ) {
    super(message);
    this.name = "CoordinationConflictError";
  }
}

export function claimPatternsOverlap(left: string, right: string) {
  const leftDirectory = left.endsWith("/**");
  const rightDirectory = right.endsWith("/**");
  const leftPath = leftDirectory ? left.slice(0, -3) : left;
  const rightPath = rightDirectory ? right.slice(0, -3) : right;
  if (!leftDirectory && !rightDirectory) return leftPath === rightPath;
  if (leftDirectory && rightDirectory) {
    return (
      leftPath === rightPath ||
      leftPath.startsWith(`${rightPath}/`) ||
      rightPath.startsWith(`${leftPath}/`)
    );
  }
  const directory = leftDirectory ? leftPath : rightPath;
  const exact = leftDirectory ? rightPath : leftPath;
  return exact.startsWith(`${directory}/`);
}

export function claimCoversPath(pattern: string, path: string) {
  return pattern.endsWith("/**")
    ? path.startsWith(`${pattern.slice(0, -3)}/`)
    : pattern === path;
}

export function claimSerializationScope(workspaceId: string) {
  return `workspace:${workspaceId}`;
}

async function sessionContext(
  workspaceId: string,
  sessionId: string,
  database: DatabaseExecutor = getDatabase(),
) {
  const [session] = await database
    .select({
      id: schema.agentSessions.id,
      workspaceId: schema.agentSessions.workspaceId,
      worktreeId: schema.agentSessions.worktreeId,
    })
    .from(schema.agentSessions)
    .where(
      and(
        eq(schema.agentSessions.id, sessionId),
        eq(schema.agentSessions.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!session) throw new Error("Agent session not found.");
  return session;
}

async function expireClaims(
  sessionIds: string[],
  database: DatabaseExecutor = getDatabase(),
) {
  if (!sessionIds.length) return;
  await database
    .update(schema.pathClaims)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        inArray(schema.pathClaims.sessionId, sessionIds),
        inArray(schema.pathClaims.status, ["active", "contested"]),
        sql`${schema.pathClaims.expiresAt} <= now()`,
      ),
    );
}

export async function listPathClaims(workspaceId: string, sessionId: string) {
  await sessionContext(workspaceId, sessionId);
  await expireClaims([sessionId]);
  return getDatabase()
    .select()
    .from(schema.pathClaims)
    .where(eq(schema.pathClaims.sessionId, sessionId))
    .orderBy(asc(schema.pathClaims.createdAt));
}

export async function listWorkspacePathClaims(
  workspaceId: string,
  sessionId: string,
) {
  await sessionContext(workspaceId, sessionId);
  const sessions = await getDatabase()
    .select({ id: schema.agentSessions.id })
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.workspaceId, workspaceId));
  const sessionIds = sessions.map((session) => session.id);
  await expireClaims(sessionIds);
  if (!sessionIds.length) return [];
  return getDatabase()
    .select({
      id: schema.pathClaims.id,
      sessionId: schema.pathClaims.sessionId,
      pathGlob: schema.pathClaims.pathGlob,
      intent: schema.pathClaims.intent,
      revision: schema.pathClaims.revision,
      status: schema.pathClaims.status,
      expiresAt: schema.pathClaims.expiresAt,
    })
    .from(schema.pathClaims)
    .where(
      and(
        inArray(schema.pathClaims.sessionId, sessionIds),
        inArray(schema.pathClaims.status, ["active", "contested"]),
        gt(schema.pathClaims.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(schema.pathClaims.createdAt));
}

export async function createPathClaim(
  workspaceId: string,
  sessionId: string,
  rawInput: unknown,
) {
  const input = createPathClaimSchema.parse(rawInput);
  return getDatabase().transaction(async (transaction) => {
    await sessionContext(workspaceId, sessionId, transaction);
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${claimSerializationScope(workspaceId)}))`,
    );
    const sessions = await transaction
      .select({ id: schema.agentSessions.id })
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.workspaceId, workspaceId));
    const sessionIds = sessions.map((candidate) => candidate.id);
    await expireClaims(sessionIds, transaction);
    const active = await transaction
      .select()
      .from(schema.pathClaims)
      .where(
        and(
          inArray(schema.pathClaims.sessionId, sessionIds),
          inArray(schema.pathClaims.status, ["active", "contested"]),
          gt(schema.pathClaims.expiresAt, new Date()),
        ),
      );
    const overlaps = active.filter(
      (claim) =>
        claim.sessionId !== sessionId &&
        claimPatternsOverlap(claim.pathGlob, input.path),
    );
    if (overlaps.length && !input.contest) {
      throw new CoordinationConflictError(
        `Path overlaps claim ${overlaps[0]?.pathGlob}.`,
        overlaps[0]?.id,
      );
    }
    if (overlaps.length) {
      await transaction
        .update(schema.pathClaims)
        .set({ status: "contested", updatedAt: new Date() })
        .where(
          inArray(
            schema.pathClaims.id,
            overlaps.map((claim) => claim.id),
          ),
        );
    }
    const [claim] = await transaction
      .insert(schema.pathClaims)
      .values({
        sessionId,
        pathGlob: input.path,
        intent: input.intent,
        revision: input.revision,
        status: overlaps.length ? "contested" : "active",
        expiresAt: new Date(Date.now() + input.ttlSeconds * 1_000),
      })
      .returning();
    if (!claim) throw new Error("Could not create the path claim.");
    return claim;
  });
}

export async function releasePathClaim(
  workspaceId: string,
  sessionId: string,
  claimId: string,
) {
  await sessionContext(workspaceId, sessionId);
  const [claim] = await getDatabase()
    .update(schema.pathClaims)
    .set({ status: "released", updatedAt: new Date() })
    .where(
      and(
        eq(schema.pathClaims.id, claimId),
        eq(schema.pathClaims.sessionId, sessionId),
        inArray(schema.pathClaims.status, ["active", "contested"]),
      ),
    )
    .returning();
  if (!claim) throw new Error("Active path claim not found.");
  return claim;
}

export async function requireActivePathClaim(
  workspaceId: string,
  sessionId: string,
  path: string,
  expectedRevision: string,
) {
  await sessionContext(workspaceId, sessionId);
  await expireClaims([sessionId]);
  const claims = await getDatabase()
    .select()
    .from(schema.pathClaims)
    .where(
      and(
        eq(schema.pathClaims.sessionId, sessionId),
        eq(schema.pathClaims.status, "active"),
        gt(schema.pathClaims.expiresAt, new Date()),
      ),
    );
  const claim = claims.find(
    (candidate) =>
      claimCoversPath(candidate.pathGlob, path) &&
      (candidate.pathGlob.endsWith("/**") ||
        candidate.revision === expectedRevision),
  );
  if (!claim) {
    throw new CoordinationConflictError(
      "An owned active claim at the current revision is required before writing.",
    );
  }
  return claim;
}

export async function listCoordinationMessages(
  workspaceId: string,
  sessionId: string,
) {
  await sessionContext(workspaceId, sessionId);
  return getDatabase()
    .select()
    .from(schema.coordinationMessages)
    .where(
      and(
        eq(schema.coordinationMessages.workspaceId, workspaceId),
        or(
          eq(schema.coordinationMessages.fromSessionId, sessionId),
          eq(schema.coordinationMessages.toSessionId, sessionId),
        ),
      ),
    )
    .orderBy(asc(schema.coordinationMessages.createdAt));
}

export async function createCoordinationMessage(
  workspaceId: string,
  fromSessionId: string,
  rawInput: unknown,
) {
  const input: CoordinationMessageInput =
    coordinationMessageInputSchema.parse(rawInput);
  if (input.toSessionId === fromSessionId) {
    throw new Error("Coordination messages require another agent session.");
  }
  await Promise.all([
    sessionContext(workspaceId, fromSessionId),
    sessionContext(workspaceId, input.toSessionId),
  ]);
  if (input.kind === "claim_request") {
    const [claim] = await getDatabase()
      .select({ id: schema.pathClaims.id, path: schema.pathClaims.pathGlob })
      .from(schema.pathClaims)
      .where(
        and(
          eq(schema.pathClaims.id, input.payload.claimId),
          eq(schema.pathClaims.sessionId, fromSessionId),
          inArray(schema.pathClaims.status, ["active", "contested"]),
        ),
      )
      .limit(1);
    if (!claim || claim.path !== input.payload.path) {
      throw new Error("Claim request must reference an owned current claim.");
    }
  }

  let correlationId = input.correlationId ?? randomUUID();
  if (input.responseToId) {
    const [original] = await getDatabase()
      .select()
      .from(schema.coordinationMessages)
      .where(
        and(
          eq(schema.coordinationMessages.id, input.responseToId),
          eq(schema.coordinationMessages.workspaceId, workspaceId),
          eq(schema.coordinationMessages.fromSessionId, input.toSessionId),
          eq(schema.coordinationMessages.toSessionId, fromSessionId),
        ),
      )
      .limit(1);
    if (!original)
      throw new Error("Referenced coordination message not found.");
    if (
      input.kind === "claim_response" &&
      (original.kind !== "claim_request" ||
        original.payload.claimId !== input.payload.claimId)
    ) {
      throw new Error("Claim response does not match the original request.");
    }
    if (input.correlationId && input.correlationId !== original.correlationId) {
      throw new Error(
        "Response correlation does not match the original message.",
      );
    }
    correlationId = original.correlationId;
  }

  const [message] = await getDatabase()
    .insert(schema.coordinationMessages)
    .values({
      workspaceId,
      fromSessionId,
      toSessionId: input.toSessionId,
      kind: input.kind,
      payload: input.payload,
      correlationId,
      responseToId: input.responseToId ?? null,
    })
    .returning();
  if (!message) throw new Error("Could not create coordination message.");
  return message;
}

export async function updateCoordinationMessageStatus(
  workspaceId: string,
  sessionId: string,
  messageId: string,
  status: "delivered" | "resolved",
) {
  await sessionContext(workspaceId, sessionId);
  const [message] = await getDatabase()
    .update(schema.coordinationMessages)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(schema.coordinationMessages.id, messageId),
        eq(schema.coordinationMessages.workspaceId, workspaceId),
        eq(schema.coordinationMessages.toSessionId, sessionId),
      ),
    )
    .returning();
  if (!message) throw new Error("Coordination message not found.");
  return message;
}
