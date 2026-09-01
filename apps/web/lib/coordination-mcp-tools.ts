import "server-only";

import {
  CoordinationConflictError,
  createCoordinationMessage,
  createPathClaim,
  listCoordinationMessages,
  listWorkspacePathClaims,
  releasePathClaim,
  updateCoordinationMessageStatus,
} from "./agent-coordination";
import { agentSessionChatLabel } from "./cli-agent-session";
import {
  findChannelBySlug,
  postChannelMessage,
  readTeamChatContext,
} from "./team-chat";
import {
  buildAgentBriefing,
  recordBrainEntry,
  safeDetectOverlaps,
  searchBrain,
  updateAgentBrief,
} from "./workspace-brain";

/**
 * The coordination toolset exposed to the workspace's agent CLIs over MCP
 * (`/api/workspaces/[id]/mcp/coordination`). This is the "core loop": declare
 * what you're about to do, see what everyone else is doing and where you'd
 * collide, claim the files you need, and leave findings behind. Every tool is a
 * thin pass to an existing `workspace-brain` / `agent-coordination` /
 * `team-chat` function, scoped to the caller's `sessionId` from its bearer
 * token.
 *
 * The toolset deliberately matches what the managed runtime already hands its
 * own agents (`agent-runtime.ts`). It shipped first without peer negotiation
 * or team chat, which left a live contradiction: the brain's own overlap
 * warning tells an agent to "use request_claim_coordination, post_team_chat",
 * tools a CLI agent did not have. An agent must never be pointed at a tool it
 * cannot call, so the two sets are kept in step.
 */

export type CoordinationToolContext = {
  workspaceId: string;
  sessionId: string;
  userId: string;
};

export type CoordinationToolResult = {
  /** Text handed back to the model. */
  text: string;
  /** True when the call could not be completed as asked (bad input, blocked
   *  claim) — the model should read `text` and adapt, not retry verbatim. */
  isError: boolean;
};

type JsonObject = Record<string, unknown>;

export type CoordinationToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonObject;
};

const CLAIM_PATH_PROPERTY = {
  type: "string",
  description: "Repo-relative POSIX path or a `dir/**` glob.",
} as const;

const BRANCH_PROPERTY = {
  type: "string",
  description:
    "Your current git branch (`git branch --show-current`). Required when this coordination server is shared by the whole workspace, so your session can be identified.",
} as const;

const RAW_COORDINATION_TOOLS: readonly CoordinationToolDefinition[] = [
  {
    name: "situational_awareness",
    description:
      "What every other agent in this workspace is doing right now, where your work would overlap theirs, and what has already been tried. Call this before you start and whenever your plan changes.",
    inputSchema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description:
            "One line on what you are about to do, used to rank prior attempts and overlaps. Defaults to your posted goal.",
        },
      },
    },
  },
  {
    name: "declare_intent",
    description:
      "Post or update your brief — goal, approach, current step, files you expect to touch — so other agents can see it and the workspace can flag if two of you are converging. Call once up front, then keep `currentStep` / `status` fresh.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        approachSummary: { type: "string" },
        currentStep: { type: "string" },
        status: {
          type: "string",
          enum: ["planning", "active", "blocked", "paused", "done"],
        },
        filesLikelyToTouch: {
          type: "array",
          items: { type: "string" },
          description: "Repo-relative paths or `dir/**` globs.",
        },
      },
    },
  },
  {
    name: "claim_path",
    description:
      "Claim a file or `dir/**` before you edit it. If another live agent already holds an overlapping claim this returns blocked (not an error) with who holds it — then either wait, pick another path, or `contest_path`.",
    inputSchema: {
      type: "object",
      required: ["path", "intent"],
      properties: {
        path: CLAIM_PATH_PROPERTY,
        intent: {
          type: "string",
          description: "Why you need it — one line.",
        },
        revision: {
          type: "string",
          description:
            "The revision you're working from (a git sha, or leave unset).",
        },
        ttlSeconds: {
          type: "number",
          description: "How long to hold it (30–3600, default 900).",
        },
      },
    },
  },
  {
    name: "contest_path",
    description:
      "Claim a path even though another agent holds an overlapping claim, marking it contested. Use only after you've checked their brief and it's genuinely the same work or theirs is stale.",
    inputSchema: {
      type: "object",
      required: ["path", "intent"],
      properties: {
        path: CLAIM_PATH_PROPERTY,
        intent: { type: "string" },
        revision: { type: "string" },
        ttlSeconds: { type: "number" },
      },
    },
  },
  {
    name: "release_claim",
    description: "Release one of your path claims once you're done with it.",
    inputSchema: {
      type: "object",
      required: ["claimId"],
      properties: { claimId: { type: "string" } },
    },
  },
  {
    name: "list_claims",
    description:
      "Every live path claim in the workspace — yours and every other agent's — so you can see what's taken before you plan an edit.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_brain",
    description:
      "Search what other agents have recorded in this workspace — decisions, attempts, dead ends, findings, conventions — before you try something.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "Default 8, max 20." },
      },
    },
  },
  {
    name: "record_finding",
    description:
      "Leave a durable note for the other agents: a decision, an attempt, a dead end, a finding, a convention, or a handoff. Include the paths it's about.",
    inputSchema: {
      type: "object",
      required: ["kind", "title"],
      properties: {
        kind: {
          type: "string",
          enum: [
            "decision",
            "attempt",
            "dead_end",
            "finding",
            "convention",
            "handoff",
          ],
        },
        title: { type: "string" },
        body: { type: "string" },
        paths: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "list_coordination",
    description:
      "Coordination messages addressed to or from your session (claim requests and responses from other agents). Read this to find the `id`, `correlationId` and `fromSessionId` you need to answer with respond_to_claim.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "request_claim_coordination",
    description:
      "Ask the agent you are colliding with to negotiate, instead of overwriting them. Send this about a claim you hold, naming the session you want to reach — `situational_awareness` prints the session id of every agent you overlap with, and `list_claims` gives the session id behind any live claim.",
    inputSchema: {
      type: "object",
      required: ["toSessionId", "claimId", "path", "intent"],
      properties: {
        toSessionId: {
          type: "string",
          description: "The other agent's session id.",
        },
        claimId: {
          type: "string",
          description:
            "One of *your own* live claims (from claim_path / contest_path / list_claims).",
        },
        path: {
          type: "string",
          description: "The path that claim covers — must match it exactly.",
        },
        intent: {
          type: "string",
          description:
            "What you want to happen — one line the other agent will read.",
        },
      },
    },
  },
  {
    name: "respond_to_claim",
    description:
      "Answer a claim request another agent sent you: accept (they take it), reject (you keep it), or counter (propose a split). Take `responseToId`, `correlationId` and the sender from list_coordination.",
    inputSchema: {
      type: "object",
      required: [
        "toSessionId",
        "responseToId",
        "correlationId",
        "claimId",
        "decision",
      ],
      properties: {
        toSessionId: {
          type: "string",
          description: "`fromSessionId` of the request you are answering.",
        },
        responseToId: {
          type: "string",
          description: "`id` of the request you are answering.",
        },
        correlationId: {
          type: "string",
          description: "`correlationId` of the request you are answering.",
        },
        claimId: { type: "string", description: "The claim under discussion." },
        decision: {
          type: "string",
          enum: ["accept", "reject", "counter"],
        },
        reason: {
          type: "string",
          description: "Why — one line. Required for reject and counter.",
        },
        proposedPath: {
          type: "string",
          description:
            "With `counter`: the narrower path or `dir/**` you are proposing they take instead.",
        },
      },
    },
  },
  {
    name: "resolve_coordination",
    description:
      "Mark a coordination message sent to you as delivered or resolved, so a settled negotiation stops coming back from list_coordination.",
    inputSchema: {
      type: "object",
      required: ["messageId", "status"],
      properties: {
        messageId: { type: "string" },
        status: { type: "string", enum: ["delivered", "resolved"] },
      },
    },
  },
  {
    name: "read_team_chat",
    description:
      "Read what the humans on this workspace are saying to each other in their team channels. Use it for intent, decisions, and priorities that are not in the repository.",
    inputSchema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description:
            "Channel name without the leading `#`. Omit to read every channel open to agents.",
        },
      },
    },
  },
  {
    name: "post_team_chat",
    description:
      "Post into a team channel so the humans see it — answer a mention, report a blocking finding, or say what you decided. Channels the team has closed to agents will refuse the post.",
    inputSchema: {
      type: "object",
      required: ["channel", "body"],
      properties: {
        channel: {
          type: "string",
          description: "Channel name, with or without the leading `#`.",
        },
        body: { type: "string" },
      },
    },
  },
];

/**
 * Every tool also accepts `branch` (and `agentKind`). The MCP route consumes
 * them before dispatch on a workspace-scoped token — where the server is shared
 * by every agent CLI — and ignores them on a session-scoped token. Injected
 * here so the schemas stay in one place.
 */
export const COORDINATION_TOOLS: readonly CoordinationToolDefinition[] =
  RAW_COORDINATION_TOOLS.map((tool) => ({
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...((tool.inputSchema.properties as JsonObject | undefined) ?? {}),
        branch: BRANCH_PROPERTY,
        agentKind: {
          type: "string",
          description: "`claude`, `codex`, … — only needed on your first call.",
        },
      },
    },
  }));

function ok(text: string): CoordinationToolResult {
  return { text, isError: false };
}

function fail(text: string): CoordinationToolResult {
  return { text, isError: true };
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Channel names reach us with or without the leading `#`. */
function channelSlug(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^#/, "") : "";
}

export async function callCoordinationTool(
  context: CoordinationToolContext,
  name: string,
  rawArgs: unknown,
): Promise<CoordinationToolResult> {
  const args: JsonObject =
    rawArgs && typeof rawArgs === "object" ? (rawArgs as JsonObject) : {};
  const { workspaceId, sessionId, userId } = context;

  try {
    switch (name) {
      case "situational_awareness": {
        const intent =
          typeof args.intent === "string" && args.intent.trim()
            ? args.intent.trim()
            : "";
        const briefing = await buildAgentBriefing(
          workspaceId,
          sessionId,
          intent,
        );
        if (!briefing) {
          return ok(
            "Nothing else is happening in this workspace right now — no other agent briefs, overlaps, or prior attempts.",
          );
        }
        return ok(
          `${briefing.text}\n\n(${briefing.otherAgents} other agent(s), ${briefing.overlaps} overlap(s) touching your work, ${briefing.priorAttempts} related prior attempt(s).)`,
        );
      }

      case "declare_intent": {
        const patch: JsonObject = {};
        for (const key of [
          "goal",
          "approachSummary",
          "currentStep",
          "status",
          "filesLikelyToTouch",
        ]) {
          if (args[key] !== undefined) {
            patch[key] = args[key];
          }
        }
        if (Object.keys(patch).length === 0) {
          return fail(
            "declare_intent needs at least one of: goal, approachSummary, currentStep, status, filesLikelyToTouch.",
          );
        }
        const brief = await updateAgentBrief(workspaceId, sessionId, patch);
        await safeDetectOverlaps(workspaceId);
        const briefing = await buildAgentBriefing(
          workspaceId,
          sessionId,
          brief.goal,
        );
        return ok(
          `Brief updated.\n${pretty(brief)}${
            briefing && briefing.overlaps > 0
              ? `\n\nHeads up — the workspace sees you converging with another agent:\n${briefing.text}`
              : ""
          }`,
        );
      }

      case "claim_path": {
        try {
          const claim = await createPathClaim(workspaceId, sessionId, {
            path: args.path,
            intent: args.intent,
            revision:
              typeof args.revision === "string" && args.revision.trim()
                ? args.revision
                : "working",
            ...(typeof args.ttlSeconds === "number"
              ? { ttlSeconds: args.ttlSeconds }
              : {}),
          });
          return ok(`Claim granted.\n${pretty(claim)}`);
        } catch (error) {
          if (error instanceof CoordinationConflictError) {
            return ok(
              `Blocked: another live agent holds an overlapping claim${
                error.claimId ? ` (${error.claimId})` : ""
              }. Check their brief with situational_awareness or list_claims, then either wait, take a different path, ask them to negotiate with request_claim_coordination, or contest_path if their claim is stale or it is genuinely the same work.`,
            );
          }
          throw error;
        }
      }

      case "contest_path": {
        const claim = await createPathClaim(workspaceId, sessionId, {
          path: args.path,
          intent: args.intent,
          revision:
            typeof args.revision === "string" && args.revision.trim()
              ? args.revision
              : "working",
          contest: true,
          ...(typeof args.ttlSeconds === "number"
            ? { ttlSeconds: args.ttlSeconds }
            : {}),
        });
        return ok(`Contested claim recorded.\n${pretty(claim)}`);
      }

      case "release_claim": {
        if (typeof args.claimId !== "string" || !args.claimId) {
          return fail("release_claim requires a claimId.");
        }
        await releasePathClaim(workspaceId, sessionId, args.claimId);
        return ok(`Released ${args.claimId}.`);
      }

      case "list_claims": {
        const claims = await listWorkspacePathClaims(workspaceId, sessionId);
        return ok(
          claims.length
            ? pretty(claims)
            : "No live path claims in this workspace.",
        );
      }

      case "search_brain": {
        if (typeof args.query !== "string" || !args.query.trim()) {
          return fail("search_brain requires a query.");
        }
        const limit =
          typeof args.limit === "number"
            ? Math.max(1, Math.min(20, Math.trunc(args.limit)))
            : 8;
        const results = await searchBrain(workspaceId, sessionId, {
          query: args.query,
          limit,
        });
        return ok(
          results.entries.length > 0 || results.briefs.length > 0
            ? pretty(results)
            : "No matching brain entries or agent briefs.",
        );
      }

      case "record_finding": {
        const entry = await recordBrainEntry(workspaceId, sessionId, userId, {
          kind: args.kind,
          title: args.title,
          body: typeof args.body === "string" ? args.body : "",
          paths: Array.isArray(args.paths) ? args.paths : [],
        });
        return ok(`Recorded.\n${pretty(entry)}`);
      }

      case "list_coordination": {
        const messages = await listCoordinationMessages(workspaceId, sessionId);
        return ok(
          messages.length ? pretty(messages) : "No coordination messages.",
        );
      }

      case "request_claim_coordination": {
        for (const key of ["toSessionId", "claimId", "path", "intent"]) {
          if (typeof args[key] !== "string" || !(args[key] as string).trim()) {
            return fail(
              "request_claim_coordination requires toSessionId, claimId, path and intent. Get the other agent's session id from situational_awareness or list_claims, and use one of your own live claims.",
            );
          }
        }
        const message = await createCoordinationMessage(
          workspaceId,
          sessionId,
          {
            toSessionId: args.toSessionId,
            kind: "claim_request",
            payload: {
              claimId: args.claimId,
              path: args.path,
              intent: args.intent,
            },
          },
        );
        return ok(
          `Coordination requested. They see it on their next list_coordination; watch for their answer there.\n${pretty(message)}`,
        );
      }

      case "respond_to_claim": {
        const decision = args.decision;
        if (
          decision !== "accept" &&
          decision !== "reject" &&
          decision !== "counter"
        ) {
          return fail(
            "respond_to_claim needs decision to be accept, reject or counter.",
          );
        }
        for (const key of [
          "toSessionId",
          "responseToId",
          "correlationId",
          "claimId",
        ]) {
          if (typeof args[key] !== "string" || !(args[key] as string).trim()) {
            return fail(
              "respond_to_claim requires toSessionId, responseToId, correlationId and claimId — all four come from the request as list_coordination printed it.",
            );
          }
        }
        const reason =
          typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason && decision !== "accept") {
          return fail(
            `A ${decision} needs a reason — the other agent has to act on it.`,
          );
        }
        const message = await createCoordinationMessage(
          workspaceId,
          sessionId,
          {
            toSessionId: args.toSessionId,
            kind: "claim_response",
            correlationId: args.correlationId,
            responseToId: args.responseToId,
            payload: {
              claimId: args.claimId,
              decision,
              // Both are optional in the contract and rejected when empty, so
              // send them only when there is something to send.
              ...(reason ? { reason } : {}),
              ...(typeof args.proposedPath === "string" &&
              args.proposedPath.trim()
                ? { proposedPath: args.proposedPath.trim() }
                : {}),
            },
          },
        );
        return ok(`Answered with ${decision}.\n${pretty(message)}`);
      }

      case "resolve_coordination": {
        if (typeof args.messageId !== "string" || !args.messageId.trim()) {
          return fail("resolve_coordination requires a messageId.");
        }
        if (args.status !== "delivered" && args.status !== "resolved") {
          return fail(
            "resolve_coordination needs status to be delivered or resolved.",
          );
        }
        const message = await updateCoordinationMessageStatus(
          workspaceId,
          sessionId,
          args.messageId,
          args.status,
        );
        return ok(`Marked ${args.status}.\n${pretty(message)}`);
      }

      case "read_team_chat": {
        const slug = channelSlug(args.channel);
        const context = await readTeamChatContext(
          workspaceId,
          slug ? { channelSlug: slug } : {},
        );
        return ok(pretty(context));
      }

      case "post_team_chat": {
        const slug = channelSlug(args.channel);
        if (!slug) {
          return fail("post_team_chat requires a channel name.");
        }
        if (typeof args.body !== "string" || !args.body.trim()) {
          return fail("post_team_chat requires a message body.");
        }
        const channel = await findChannelBySlug(workspaceId, slug);
        if (!channel) {
          return fail(`No channel named #${slug}.`);
        }
        // `postChannelMessage` refuses an agent author on a channel the team
        // has closed to agents; surface that as an answer the model can act
        // on rather than an exception.
        const { message } = await postChannelMessage({
          workspaceId,
          channelId: channel.id,
          body: args.body.trim(),
          author: {
            kind: "agent",
            label: await agentSessionChatLabel(workspaceId, sessionId),
            agentSessionId: sessionId,
          },
        });
        return ok(`Posted to #${slug} (${message.id}).`);
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return fail(messageOf(error));
  }
}
