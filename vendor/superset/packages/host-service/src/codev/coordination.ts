import { createHash, timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { Hono } from "hono";
import { z } from "zod";
import type { HostDb } from "../db";
import { readChangeSet, readCurrentBranch } from "./change-set";
import {
	createNativeAgentRegistry,
	listSupersetAgents,
} from "./coordination-agents";
import { createCoordinationNotices } from "./coordination-notices";
import { resolveCoDevWorktreeRoot } from "./files";
import { hookReply, noticeText } from "./notice-text";
import {
	findWorktreeOverlaps,
	MAX_REPORTED_OVERLAPS,
} from "./worktree-overlaps";
import { CODEV_WORKTREE_ID_PATTERN } from "./worktree-paths";

const MAX_WORKTREES = 16;

const worktreeIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(CODEV_WORKTREE_ID_PATTERN);
const overlapRequestSchema = z.object({
	worktreeIds: z.array(worktreeIdSchema).min(1).max(MAX_WORKTREES),
});
const nativeAgentIdSchema = z.string().regex(/^native-[a-f0-9]{16}$/);
const noticeRequestSchema = z.object({
	agentId: z.string().min(1).max(128),
});
const nativeAgentSchema = z.object({
	agentId: nativeAgentIdSchema,
	worktreeId: worktreeIdSchema,
	harness: z.enum(["claude", "codex", "cursor"]),
	tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
});

type WorktreeState =
	| {
			worktreeId: string;
			state: "known";
			fileCount: number;
			symbolsKnown: boolean;
	  }
	| { worktreeId: string; state: "large" | "unavailable" };

function secretMatches(actual: string | undefined, expected: string) {
	if (!actual) return false;
	const received = Buffer.from(actual);
	const configured = Buffer.from(expected);
	return (
		received.length === configured.length &&
		timingSafeEqual(received, configured)
	);
}

function hookTokenMatches(expectedHash: string, token: string | undefined) {
	if (!token || !expectedHash) return false;
	const actual = Buffer.from(createHash("sha256").update(token).digest("hex"));
	const expected = Buffer.from(expectedHash);
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readWorktree(
	workspaceRoot: string,
	primaryRoot: string,
	worktreeId: string,
) {
	try {
		const root = await resolveCoDevWorktreeRoot(workspaceRoot, worktreeId);
		return {
			worktreeId,
			changes: await readChangeSet(root, primaryRoot),
			branch: await readCurrentBranch(root),
		};
	} catch {
		return { worktreeId, changes: undefined, branch: undefined };
	}
}

/**
 * CoDev agent coordination. The bridge-secret routes let CoDev compare the
 * worktrees it chooses and let codev-guestd register native turns. The
 * notices route answers an agent's own PostToolUse hook, authenticated by its
 * private token; any rejected or empty answer is an indistinguishable 204.
 */
export function registerCoDevCoordinationBridge({
	app,
	db,
	workspaceRoot,
	bridgeSecret,
	noticesEnabled,
	noticeRefreshDelayMs,
}: {
	app: Hono;
	db: HostDb;
	workspaceRoot: string;
	bridgeSecret: string;
	noticesEnabled: boolean;
	noticeRefreshDelayMs?: number;
}) {
	const nativeAgents = createNativeAgentRegistry();
	const listLiveAgents = () => [
		...listSupersetAgents(db),
		...nativeAgents.list(),
	];
	const requireBridge = (header: string | undefined) =>
		secretMatches(header, bridgeSecret);
	const notices = createCoordinationNotices({
		listLiveAgents,
		readWorktree: async (worktreeId) =>
			readWorktree(workspaceRoot, await realpath(workspaceRoot), worktreeId),
		...(noticeRefreshDelayMs === undefined
			? {}
			: { refreshDelayMs: noticeRefreshDelayMs }),
	});

	app.post("/codev/coordination/overlaps", async (context) => {
		if (!requireBridge(context.req.header("x-codev-bridge-secret"))) {
			return context.json({ error: "Unauthorized" }, 401);
		}
		const parsed = overlapRequestSchema.safeParse(
			await context.req.json().catch(() => undefined),
		);
		if (!parsed.success)
			return context.json({ error: "Invalid overlap request." }, 400);

		const primaryRoot = await realpath(workspaceRoot).catch(() => undefined);
		if (!primaryRoot)
			return context.json({ error: "CoDev workspace is unavailable." }, 503);
		const results = [];
		for (const worktreeId of new Set(parsed.data.worktreeIds)) {
			results.push(await readWorktree(workspaceRoot, primaryRoot, worktreeId));
		}
		const known = results.flatMap(({ worktreeId, changes }) =>
			changes?.state === "known" ? [{ worktreeId, files: changes.files }] : [],
		);
		const overlaps = findWorktreeOverlaps(known);
		const worktrees = results.map(({ worktreeId, changes }): WorktreeState => {
			if (!changes) return { worktreeId, state: "unavailable" };
			if (changes.state === "large") return { worktreeId, state: "large" };
			return {
				worktreeId,
				state: "known",
				fileCount: changes.files.length,
				symbolsKnown: changes.symbolsKnown,
			};
		});
		return context.json({
			worktrees,
			overlaps: overlaps.slice(0, MAX_REPORTED_OVERLAPS),
			truncated: overlaps.length > MAX_REPORTED_OVERLAPS,
		});
	});

	if (!noticesEnabled) return;

	app.post("/codev/coordination/agents", async (context) => {
		if (!requireBridge(context.req.header("x-codev-bridge-secret"))) {
			return context.json({ error: "Unauthorized" }, 401);
		}
		const parsed = nativeAgentSchema.safeParse(
			await context.req.json().catch(() => undefined),
		);
		if (!parsed.success) {
			return context.json({ error: "Invalid coordination agent." }, 400);
		}
		const { agentId, worktreeId, harness, tokenHash } = parsed.data;
		const registered = nativeAgents.register({
			hookId: agentId,
			worktreeId,
			harness,
			hookTokenHash: tokenHash,
		});
		if (!registered) {
			return context.json(
				{ error: "Coordination agent was not registered." },
				409,
			);
		}
		return context.json({ registered: true }, 201);
	});

	app.delete("/codev/coordination/agents/:agentId", (context) => {
		if (!requireBridge(context.req.header("x-codev-bridge-secret"))) {
			return context.json({ error: "Unauthorized" }, 401);
		}
		const agentId = nativeAgentIdSchema.safeParse(context.req.param("agentId"));
		if (!agentId.success) {
			return context.json({ error: "Invalid coordination agent." }, 400);
		}
		nativeAgents.release(agentId.data);
		return context.json({ released: true });
	});

	app.post("/codev/coordination/notices", async (context) => {
		const parsed = noticeRequestSchema.safeParse(
			await context.req.json().catch(() => undefined),
		);
		const agents = listLiveAgents();
		const agent = parsed.success
			? agents.find((candidate) => candidate.hookId === parsed.data.agentId)
			: undefined;
		if (!agent) return context.body(null, 204);
		if (
			!hookTokenMatches(
				agent.hookTokenHash,
				context.req.header("x-codev-hook-token"),
			)
		) {
			console.warn("[codev-coordination] rejected an agent hook token");
			return context.body(null, 204);
		}
		notices.requestRefresh();
		const reply = notices.take(agent, agents);
		if (!reply) return context.body(null, 204);
		return context.json(
			hookReply(agent.harness, noticeText(reply.notices, reply.unlisted)),
		);
	});
}
