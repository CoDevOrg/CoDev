import "server-only";

import type OpenAI from "openai";

/**
 * Every workspace tool an agent turn may call, as provider-neutral function
 * schemas. `createAgentTools` turns these into the AI SDK's ToolSet and
 * `executeTool` implements them.
 */
export const tools: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "claim_path",
    description:
      "Claim one exact relative path or directory/** before writing files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        intent: { type: "string" },
        revision: { type: "string" },
      },
      required: ["path", "intent", "revision"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "release_claim",
    description: "Release one of this session's path claims.",
    parameters: {
      type: "object",
      properties: { claimId: { type: "string" } },
      required: ["claimId"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_claims",
    description:
      "List active and contested path claims across all workspace agents.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "contest_path",
    description:
      "Create a contested claim after an overlap, so the owning agents can negotiate.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        intent: { type: "string" },
        revision: { type: "string" },
      },
      required: ["path", "intent", "revision"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_coordination",
    description: "List structured messages sent to or from this agent session.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "read_team_chat",
    description:
      "Read what the humans on this workspace are saying to each other in their team channels. Use it for intent, decisions, and priorities that are not in the repository.",
    parameters: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description:
            "Channel name without the leading '#'. Pass an empty string to read every channel open to agents.",
        },
      },
      required: ["channel"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "post_team_chat",
    description:
      "Post a message into a team channel so the humans see it. Use it to answer a mention, report progress, or ask a blocking question.",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string" },
        body: { type: "string" },
      },
      required: ["channel", "body"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "request_claim_coordination",
    description:
      "Ask another agent to coordinate an overlapping claim using a correlated request.",
    parameters: {
      type: "object",
      properties: {
        toSessionId: { type: "string" },
        claimId: { type: "string" },
        path: { type: "string" },
        intent: { type: "string" },
      },
      required: ["toSessionId", "claimId", "path", "intent"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "respond_to_claim",
    description:
      "Respond to a claim request with an accept, reject, or counter decision.",
    parameters: {
      type: "object",
      properties: {
        toSessionId: { type: "string" },
        responseToId: { type: "string" },
        correlationId: { type: "string" },
        claimId: { type: "string" },
        decision: { type: "string", enum: ["accept", "reject", "counter"] },
        reason: { type: "string" },
      },
      required: [
        "toSessionId",
        "responseToId",
        "correlationId",
        "claimId",
        "decision",
        "reason",
      ],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "resolve_coordination",
    description:
      "Mark a coordination message delivered or resolved after acting on it.",
    parameters: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        status: { type: "string", enum: ["delivered", "resolved"] },
      },
      required: ["messageId", "status"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "brain_update_brief",
    description:
      "Publish or update this session's brief in the workspace brain so other agents and watching humans can see what you are doing. Call it right after you plan, then keep currentStep and status fresh as you work.",
    parameters: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description:
            "One sentence: what this session is trying to accomplish.",
        },
        approachSummary: {
          type: "string",
          description: "How you intend to do it — the shape of the change.",
        },
        planSteps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              state: { type: "string", enum: ["done", "active", "pending"] },
            },
            required: ["label", "state"],
            additionalProperties: false,
          },
        },
        currentStep: {
          type: "string",
          description: "What you are doing this moment.",
        },
        filesLikelyToTouch: {
          type: "array",
          items: { type: "string" },
          description:
            "Relative paths or directory/** globs you expect to edit. Used to predict collisions before you hold a claim.",
        },
        status: {
          type: "string",
          enum: ["planning", "active", "blocked", "paused", "done"],
        },
      },
      required: ["currentStep"],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "brain_search",
    description:
      "Search the workspace brain — past decisions, attempts, dead ends and other agents' live goals — before you plan, so you do not repeat work or collide with another agent.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free text describing what you are about to work on.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "brain_record",
    description:
      "Append a durable note to the workspace brain: a decision you made, an approach that failed (dead_end), a finding, or a convention. Future agents read these.",
    parameters: {
      type: "object",
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
      required: ["kind", "title"],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "list_files",
    description: "List repository files in this agent's isolated worktree.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "read_file",
    description: "Read a UTF-8 repository file and its revision.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "write_file",
    description:
      "Write a UTF-8 repository file. Read it first and pass its current revision.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        contents: { type: "string" },
        expectedRevision: { type: "string" },
      },
      required: ["path", "contents", "expectedRevision"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "run_command",
    description:
      "Run a bounded non-interactive command in the isolated worktree. Pass argv without a shell. Prefer find and grep for repository searches; optional tools such as rg may not be installed in every guest image.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "array", items: { type: "string" } },
      },
      required: ["command"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "git_status",
    description: "Inspect Git status for this isolated worktree.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "github_sync",
    description:
      "Sync this agent worktree with the workspace GitHub default branch tip via the control plane. Prefer this over git pull/fetch.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "github_publish",
    description:
      "Publish this agent worktree to an immutable codev/* branch on GitHub via the control plane. Prefer this over git push. Pass a codev/... branch name, or an empty string to use the default.",
    parameters: {
      type: "object",
      properties: {
        branchName: { type: "string" },
      },
      required: ["branchName"],
      additionalProperties: false,
    },
    strict: true,
  },
];
