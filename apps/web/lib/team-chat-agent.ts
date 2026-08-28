import "server-only";

import { schema } from "@codev/db";
import { and, desc, eq, inArray } from "drizzle-orm";

import { getWorkspaceAccess } from "./access";
import { getDatabase } from "./database";
import { enqueueSharedSessionInstruction } from "./shared-session-server";
import { readTeamChatContext } from "./team-chat";

export type AgentMentionDispatch =
  | { dispatched: true; sessionId: string }
  | { dispatched: false; reason: string };

/**
 * The instruction an `@agent` mention turns into. The agent is told where the
 * request came from and how to answer, because a channel question answered
 * only in a private chat tab is invisible to the person who asked.
 */
export function buildAgentMentionPrompt(input: {
  channelSlug: string;
  authorName: string;
  body: string;
  digest: string;
}) {
  return [
    `${input.authorName} mentioned you in the CoDev team channel #${input.channelSlug}:`,
    "",
    input.body,
    "",
    `Recent conversation in #${input.channelSlug} (oldest first), for context:`,
    input.digest,
    "",
    `Answer the request. Post your answer back to #${input.channelSlug} with the post_team_chat tool when you have one, so the whole team sees it.`,
  ].join("\n");
}

/**
 * Finds the agent session a channel mention should go to: the most recently
 * touched live session in this workspace. Returns null when nothing is
 * running, which is a normal state and not an error.
 */
async function findMentionTargetSession(workspaceId: string) {
  const [session] = await getDatabase()
    .select({ id: schema.agentSessions.id })
    .from(schema.agentSessions)
    .where(
      and(
        eq(schema.agentSessions.workspaceId, workspaceId),
        inArray(schema.agentSessions.status, ["idle", "running", "waiting"]),
      ),
    )
    .orderBy(desc(schema.agentSessions.updatedAt))
    .limit(1);
  return session?.id ?? null;
}

/**
 * Hands a channel mention to a running agent. Every failure is reported back
 * to the caller rather than thrown: the message itself is already posted, and
 * losing a chat message because no agent was awake would be worse than a
 * mention that quietly went nowhere.
 */
export async function dispatchAgentMention(input: {
  workspaceId: string;
  channelSlug: string;
  authorName: string;
  body: string;
  user: { id: string; name?: string | null };
}): Promise<AgentMentionDispatch> {
  try {
    const access = await getWorkspaceAccess(input.workspaceId, input.user.id);
    if (!access?.permissions.coSteer) {
      return {
        dispatched: false,
        reason: "Your role cannot send instructions to agents.",
      };
    }

    const sessionId = await findMentionTargetSession(input.workspaceId);
    if (!sessionId) {
      return { dispatched: false, reason: "No agent session is running." };
    }

    const { digest } = await readTeamChatContext(input.workspaceId, {
      channelSlug: input.channelSlug,
      perChannel: 20,
    });
    await enqueueSharedSessionInstruction(
      input.workspaceId,
      sessionId,
      input.user,
      buildAgentMentionPrompt({
        channelSlug: input.channelSlug,
        authorName: input.authorName,
        body: input.body,
        digest,
      }),
    );
    return { dispatched: true, sessionId };
  } catch (error) {
    return {
      dispatched: false,
      reason:
        error instanceof Error
          ? error.message
          : "The agent could not be reached.",
    };
  }
}
