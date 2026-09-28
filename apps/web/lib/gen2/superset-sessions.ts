import "server-only";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@codev/db";

import {
  claimHostedCodexExecution,
  releaseHostedCodexExecution,
  updateHostedCodexAuthCache,
} from "../providers/hosted-codex-subscription-credentials";
import { getDatabase } from "../platform/database";
import { orchestratorRequest } from "../runtime/orchestrator-request";
import { fakeGuestEnabled } from "../runtime/fake-guest";
import { canRunGen2Agent } from "./agent-policy";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";
import { resolveGen2Codex } from "./providers";
import { requireGen2Member } from "./workspaces";

const sessionSchema = z
  .object({
    sessionId: z.string().uuid(),
    scopeId: z.string().uuid(),
    status: z.string(),
  })
  .passthrough();
const envelopeSchema = z
  .object({
    cursor: z.object({ epoch: z.string(), seq: z.number() }),
    event: z.unknown(),
  })
  .passthrough();

async function ready(workspaceId: string, userId: string, mutate = false) {
  if (process.env.CODEV_SUPERSET_SESSIONS_ENABLED !== "true") {
    throw new Gen2LifecycleError("Superset sessions are not enabled.", 503);
  }
  const member = await requireGen2Member(workspaceId, userId);
  if (!canRunGen2Agent(member.status))
    throw new Gen2LifecycleError("Start the instance first.", 409);
  if (mutate && member.role === "viewer")
    throw new Gen2AccessError("Edit permission is required to run Codex.", 403);
}

async function bridge(workspaceId: string, operation: string, body: unknown) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/superset/runtime/session/${operation}`,
    body,
    35_000,
  );
  return response.json() as Promise<unknown>;
}

async function releaseFinishedLease(
  workspaceId: string,
  userId: string,
  sessionId: string,
  envelopes: unknown[],
) {
  if (fakeGuestEnabled()) return;
  const [lease] = await getDatabase()
    .select()
    .from(schema.gen2SupersetTurnLeases)
    .where(
      and(
        eq(schema.gen2SupersetTurnLeases.sessionId, sessionId),
        eq(schema.gen2SupersetTurnLeases.workspaceId, workspaceId),
        eq(schema.gen2SupersetTurnLeases.userId, userId),
        eq(schema.gen2SupersetTurnLeases.active, true),
      ),
    )
    .limit(1);
  if (!lease) return;
  const userMessage = z.object({
    cursor: z.object({ seq: z.number() }),
    event: z.object({
      type: z.literal("item"),
      item: z.object({
        kind: z.literal("user_message"),
        clientId: z.literal(lease.commandId),
      }),
    }),
  });
  const turn = z.object({
    cursor: z.object({ seq: z.number() }),
    event: z.object({
      type: z.literal("turn"),
      turn: z.object({
        status: z.enum(["completed", "failed", "interrupted"]),
      }),
    }),
  });
  const terminalSeq = envelopes.findLast((raw) => turn.safeParse(raw).success);
  if (!terminalSeq) return;
  const lastTurn = turn.parse(terminalSeq).cursor.seq;
  let page = envelopes;
  let promptSeq: number | undefined;
  for (let index = 0; index < 100 && page.length; index += 1) {
    for (const raw of page) {
      const message = userMessage.safeParse(raw);
      if (message.success) {
        promptSeq = message.data.cursor.seq;
        break;
      }
    }
    if (promptSeq !== undefined || page.length < 500) break;
    const oldest = envelopeSchema.parse(page[0]);
    const previous = await bridge(workspaceId, "events", {
      memberId: userId,
      sessionId,
      before: oldest.cursor,
    });
    const parsed = z
      .object({
        ok: z.boolean(),
        envelopes: z.array(envelopeSchema).optional(),
      })
      .parse(previous);
    page = parsed.ok ? (parsed.envelopes ?? []) : [];
  }
  const terminal =
    promptSeq !== undefined &&
    envelopes.some((raw) => {
      const event = turn.safeParse(raw);
      return (
        event.success &&
        event.data.cursor.seq === lastTurn &&
        lastTurn > promptSeq
      );
    });
  if (!terminal) return;
  try {
    const updated = z
      .object({ authCacheJson: z.string().min(1) })
      .parse(
        await bridge(workspaceId, "auth", { memberId: userId, sessionId }),
      );
    await updateHostedCodexAuthCache(lease.credentialId, updated.authCacheJson);
  } catch {
    // Transcript delivery must survive a credential refresh readback failure.
  } finally {
    await releaseHostedCodexExecution(lease.credentialId);
    await getDatabase()
      .update(schema.gen2SupersetTurnLeases)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(schema.gen2SupersetTurnLeases.sessionId, sessionId));
  }
}

async function reconcileUserLeases(workspaceId: string, userId: string) {
  if (fakeGuestEnabled()) return;
  const leases = await getDatabase()
    .select({ sessionId: schema.gen2SupersetTurnLeases.sessionId })
    .from(schema.gen2SupersetTurnLeases)
    .where(
      and(
        eq(schema.gen2SupersetTurnLeases.workspaceId, workspaceId),
        eq(schema.gen2SupersetTurnLeases.userId, userId),
        eq(schema.gen2SupersetTurnLeases.active, true),
      ),
    );
  for (const lease of leases) {
    const payload = await bridge(workspaceId, "events", {
      memberId: userId,
      sessionId: lease.sessionId,
    });
    const parsed = z
      .object({
        ok: z.boolean(),
        envelopes: z.array(envelopeSchema).optional(),
      })
      .safeParse(payload);
    if (parsed.success && parsed.data.ok)
      await releaseFinishedLease(
        workspaceId,
        userId,
        lease.sessionId,
        parsed.data.envelopes ?? [],
      );
  }
}

export async function listSupersetSessions(
  workspaceId: string,
  userId: string,
) {
  await ready(workspaceId, userId);
  const payload = await bridge(workspaceId, "list", { memberId: userId });
  return z.object({ sessions: z.array(sessionSchema) }).parse(payload).sessions;
}

export async function createSupersetSession(
  workspaceId: string,
  userId: string,
) {
  await ready(workspaceId, userId, true);
  await reconcileUserLeases(workspaceId, userId);
  const credential = fakeGuestEnabled() ? null : await resolveGen2Codex(userId);
  if (credential?.credentialId)
    await claimHostedCodexExecution(credential.credentialId);
  try {
    const payload = await bridge(workspaceId, "create", {
      memberId: userId,
      authCacheJson: credential?.authCacheJson ?? "{}",
    });
    return z.object({ sessionId: z.string().uuid() }).parse(payload);
  } finally {
    if (credential?.credentialId)
      await releaseHostedCodexExecution(credential.credentialId);
  }
}

export async function getSupersetSession(
  workspaceId: string,
  userId: string,
  sessionId: string,
) {
  await ready(workspaceId, userId);
  const payload = await bridge(workspaceId, "get", {
    memberId: userId,
    sessionId,
  });
  return z
    .object({ session: sessionSchema.nullable(), cursor: z.unknown() })
    .parse(payload);
}

export async function getSupersetSessionEvents(
  workspaceId: string,
  userId: string,
  sessionId: string,
  before?: { epoch: string; seq: number },
) {
  await ready(workspaceId, userId);
  const payload = await bridge(workspaceId, "events", {
    memberId: userId,
    sessionId,
    before,
  });
  const result = z
    .object({
      ok: z.boolean(),
      envelopes: z.array(envelopeSchema).optional(),
      liveText: z.record(z.string(), z.string()).optional(),
      nextBefore: z
        .object({ epoch: z.string(), seq: z.number() })
        .nullable()
        .optional(),
    })
    .parse(payload);
  if (result.ok && !before)
    await releaseFinishedLease(
      workspaceId,
      userId,
      sessionId,
      result.envelopes ?? [],
    );
  return result;
}

export async function promptSupersetSession(
  workspaceId: string,
  userId: string,
  sessionId: string,
  text: string,
  commandId: string,
) {
  await ready(workspaceId, userId, true);
  const credential = fakeGuestEnabled() ? null : await resolveGen2Codex(userId);
  await reconcileUserLeases(workspaceId, userId);
  if (credential?.credentialId) {
    await claimHostedCodexExecution(credential.credentialId);
    try {
      await getDatabase()
        .insert(schema.gen2SupersetTurnLeases)
        .values({
          sessionId,
          workspaceId,
          userId,
          credentialId: credential.credentialId,
          commandId,
          active: true,
        })
        .onConflictDoUpdate({
          target: schema.gen2SupersetTurnLeases.sessionId,
          set: { commandId, active: true, updatedAt: new Date() },
        });
    } catch (error) {
      await releaseHostedCodexExecution(credential.credentialId);
      throw error;
    }
  }
  try {
    await bridge(workspaceId, "prompt", {
      memberId: userId,
      sessionId,
      text,
      commandId,
    });
  } catch (error) {
    if (credential?.credentialId) {
      await releaseHostedCodexExecution(credential.credentialId);
      await getDatabase()
        .update(schema.gen2SupersetTurnLeases)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(schema.gen2SupersetTurnLeases.sessionId, sessionId));
    }
    throw error;
  }
  return { ok: true };
}

export async function cancelSupersetSession(
  workspaceId: string,
  userId: string,
  sessionId: string,
  turnId: string,
  commandId: string,
) {
  await ready(workspaceId, userId, true);
  await bridge(workspaceId, "cancel", {
    memberId: userId,
    sessionId,
    turnId,
    commandId,
  });
  return { ok: true };
}

export async function approveSupersetSession(
  workspaceId: string,
  userId: string,
  sessionId: string,
  approvalId: string,
  decision: {
    type: "accept" | "accept_for_session" | "decline" | "cancel" | "option";
    optionId?: string | undefined;
  },
  commandId: string,
) {
  await ready(workspaceId, userId, true);
  await bridge(workspaceId, "approve", {
    memberId: userId,
    sessionId,
    approvalId,
    decision,
    commandId,
  });
  return { ok: true };
}
