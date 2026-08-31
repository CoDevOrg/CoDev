import "server-only";

import {
  CoordinationConflictError,
  createPathClaim,
  listCoordinationMessages,
  listWorkspacePathClaims,
  releasePathClaim,
} from "./agent-coordination";
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
 * thin pass to an existing `workspace-brain` / `agent-coordination` function,
 * scoped to the caller's `sessionId` from its bearer token.
 *
 * Peer-to-peer claim negotiation (`request_claim_coordination` /
 * `respond_to_claim`) and team-chat tools are a deliberate follow-up.
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

export const COORDINATION_TOOLS: readonly CoordinationToolDefinition[] = [
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
      "Coordination messages addressed to or from your session (claim requests and responses from other agents).",
    inputSchema: { type: "object", properties: {} },
  },
];

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
        const briefing = await buildAgentBriefing(workspaceId, sessionId, intent);
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
              }. Check their brief with situational_awareness, then wait, choose a different path, or contest_path if it's the same work.`,
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
          claims.length ? pretty(claims) : "No live path claims in this workspace.",
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

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return fail(messageOf(error));
  }
}
