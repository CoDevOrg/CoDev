import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { start } from "workflow/api";

import { schema } from "@codev/db";

import { getDatabase } from "./database";
import { agentSessionWorkflow } from "../workflows/agent-session";

export async function kickAgentSession(sessionId: string) {
  const [claimed] = await getDatabase()
    .update(schema.agentSessions)
    .set({
      status: "running",
      workflowRunId: null,
      lastError: null,
      interruptedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.agentSessions.id, sessionId),
        inArray(schema.agentSessions.status, [
          "idle",
          "completed",
          "interrupted",
          "failed",
        ]),
      ),
    )
    .returning({ id: schema.agentSessions.id });

  if (!claimed) return null;
  try {
    const run = await start(agentSessionWorkflow, [sessionId]);
    await getDatabase()
      .update(schema.agentSessions)
      .set({ workflowRunId: run.runId, updatedAt: new Date() })
      .where(eq(schema.agentSessions.id, sessionId));
    await getDatabase()
      .update(schema.agentTurns)
      .set({ workflowRunId: run.runId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.agentTurns.sessionId, sessionId),
          eq(schema.agentTurns.status, "queued"),
        ),
      );
    return run.runId;
  } catch (error) {
    await getDatabase()
      .update(schema.agentSessions)
      .set({
        status: "failed",
        lastError:
          error instanceof Error ? error.message : "Workflow did not start.",
        updatedAt: new Date(),
      })
      .where(eq(schema.agentSessions.id, sessionId));
    throw error;
  }
}
