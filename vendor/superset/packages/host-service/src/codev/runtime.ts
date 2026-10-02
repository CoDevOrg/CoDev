import { mkdir, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { parseCoDevWorktrees } from "./worktree-paths";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { HostDb } from "../db";
import { terminalSessions, workspaces } from "../db/schema";
import type { EventBus } from "../events";
import {
	createTerminalSessionInternal,
	disposeSessionAndWait,
	resizeTerminalSession,
	snapshotSession,
	writeFramedInputToSession,
} from "../terminal/terminal";
import { CODEV_PRIMARY_WORKTREE_ID, resolveCoDevWorktreeRoot } from "./files";

const worktreeIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
const branchSchema = z
	.string()
	.min(1)
	.max(255)
	.regex(/^(?!-)(?!.*\.\.)(?!.*[~^:?*\[\\\s])[^/](?:.*[^/.])?$/);
const dimensionsSchema = z.object({
	rows: z.number().int().min(1).max(500),
	columns: z.number().int().min(1).max(500),
});
const terminalStartSchema = dimensionsSchema.extend({
	worktreeId: worktreeIdSchema,
});
const terminalInputSchema = z.object({ data: z.string().max(64 * 1024) });
const terminalPollSchema = z.object({ after: z.number().int().nonnegative() });
const worktreeCreateSchema = z.object({
	worktreeId: worktreeIdSchema.refine((id) => id !== CODEV_PRIMARY_WORKTREE_ID),
	branch: branchSchema,
	baseRef: z.string().min(1).max(255).optional(),
});

type GitClient = { raw: (args: string[]) => Promise<string> };
type GitFactory = (worktreePath: string) => Promise<GitClient>;

export type CoDevRuntimeBridgeOptions = {
	app: Hono;
	db: HostDb;
	eventBus: EventBus;
	git: GitFactory;
	workspaceRoot: string;
	bridgeSecret: string;
};

type TerminalPollState = { sequence: number; text: string };
const terminalPollStates = new Map<string, TerminalPollState>();
let terminalSequence = 0;

function secretMatches(actual: string | undefined, expected: string) {
	if (!actual) return false;
	const received = Buffer.from(actual);
	const configured = Buffer.from(expected);
	return received.length === configured.length && timingSafeEqual(received, configured);
}

function isWithin(rootPath: string, candidate: string) {
	const path = relative(rootPath, candidate);
	return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}

function hostWorkspaceId(worktreeId: string) {
	return `codev-${worktreeId}`;
}

async function branchAt(git: GitFactory, root: string) {
	const branch = (await (await git(root)).raw(["branch", "--show-current"])).trim();
	return branch || "HEAD";
}

async function ensureTerminalWorkspace({
	db,
	git,
	workspaceRoot,
	worktreeId,
}: Pick<CoDevRuntimeBridgeOptions, "db" | "git" | "workspaceRoot"> & {
	worktreeId: string;
}) {
	const worktreePath = await resolveCoDevWorktreeRoot(workspaceRoot, worktreeId);
	const id = hostWorkspaceId(worktreeId);
	const existing = db.query.workspaces.findFirst({ where: eq(workspaces.id, id) }).sync();
	if (existing) {
		if (existing.worktreePath !== worktreePath) {
			throw new Error("CoDev worktree identity points at a different checkout.");
		}
		return { id, worktreePath };
	}
	const now = Date.now();
	db.insert(workspaces)
		.values({
			id,
			projectId: null,
			worktreePath,
			branch: await branchAt(git, worktreePath),
			name: `CoDev ${worktreeId}`,
			type: "worktree",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return { id, worktreePath };
}

function terminalError(error: unknown) {
	return error && typeof error === "object" && "error" in error
		? String(error.error)
		: "Superset terminal operation failed.";
}

function parseWorktreeList(output: string, primaryRoot: string) {
	return parseCoDevWorktrees(output, primaryRoot).map(({ worktreeId, branch }) => ({ worktreeId, branch }));
}

/**
 * Private operations for codev-guestd. They intentionally reuse Superset's
 * terminal lifecycle and Git client; the browser only reaches them through
 * CoDev's membership and capability checks.
 */
export function registerCoDevRuntimeBridge({
	app,
	db,
	eventBus,
	git,
	workspaceRoot,
	bridgeSecret,
}: CoDevRuntimeBridgeOptions) {
	const requireBridge = (request: Request) =>
		secretMatches(request.headers.get("x-codev-bridge-secret") ?? undefined, bridgeSecret);

	app.get("/codev/git", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const worktreeId = worktreeIdSchema.safeParse(context.req.query("worktreeId"));
		const operation = z.enum(["status", "diff"]).safeParse(context.req.query("operation"));
		if (!worktreeId.success || !operation.success) return context.json({ error: "Invalid Git request." }, 400);
		try {
			const root = await resolveCoDevWorktreeRoot(workspaceRoot, worktreeId.data);
			const output = await (await git(root)).raw(
				operation.data === "status" ? ["status", "--short", "--branch"] : ["diff", "--no-ext-diff"],
			);
			return context.json({ output });
		} catch (error) {
			return context.json({ error: error instanceof Error ? error.message : "Could not read Git state." }, 400);
		}
	});

	app.get("/codev/worktrees", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		try {
			const root = await realpath(workspaceRoot);
			return context.json({ worktrees: parseWorktreeList(await (await git(root)).raw(["worktree", "list", "--porcelain"]), root) });
		} catch (error) {
			return context.json({ error: error instanceof Error ? error.message : "Could not list worktrees." }, 400);
		}
	});

	app.post("/codev/worktrees", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = worktreeCreateSchema.safeParse(await context.req.json().catch(() => undefined));
		if (!parsed.success) return context.json({ error: "Invalid worktree creation request." }, 400);
		try {
			const root = await realpath(workspaceRoot);
			const managedRoot = resolve(root, ".git", "codev-agent-worktrees");
			const target = resolve(managedRoot, parsed.data.worktreeId);
			if (!isWithin(managedRoot, target)) throw new Error("Worktree path escapes the workspace.");
			await mkdir(managedRoot, { recursive: true });
			const branchNames = (await (await git(root)).raw([
				"for-each-ref",
				"--format=%(refname:short)",
				"refs/heads",
			]))
				.split("\n")
				.map((branch) => branch.trim());
			const branchExists = branchNames.includes(parsed.data.branch);
			if (branchExists && parsed.data.baseRef) {
				return context.json(
					{ error: "baseRef can only be supplied when creating a new branch." },
					400,
				);
			}
			await (await git(root)).raw(
				branchExists
					? ["worktree", "add", target, parsed.data.branch]
					: [
							"worktree",
							"add",
							"-b",
							parsed.data.branch,
							target,
							parsed.data.baseRef ?? "HEAD",
						],
			);
			return context.json({ worktree: { worktreeId: parsed.data.worktreeId, branch: parsed.data.branch } }, 201);
		} catch (error) {
			return context.json({ error: error instanceof Error ? error.message : "Could not create worktree." }, 400);
		}
	});

	app.post("/codev/terminal", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = terminalStartSchema.safeParse(await context.req.json().catch(() => undefined));
		if (!parsed.success) return context.json({ error: "Invalid terminal start request." }, 400);
		try {
			const workspace = await ensureTerminalWorkspace({ db, git, workspaceRoot, worktreeId: parsed.data.worktreeId });
			const terminalId = `term-${Date.now()}-${++terminalSequence}`;
			const created = await createTerminalSessionInternal({
				terminalId,
				workspaceId: workspace.id,
				db,
				eventBus,
				rows: parsed.data.rows,
				cols: parsed.data.columns,
				includeDefaultAccountEnv: false,
				// The image reserves uid/gid 2000 for codev-shell. setpriv drops
				// directly to it without a PAM session, matching codev-guestd.
				shell: "/usr/bin/setpriv",
				shellArgs: [
					"--reuid=2000",
					"--regid=2000",
					"--clear-groups",
					"--",
					"/bin/sh",
					"-l",
				],
			});
			if ("error" in created) return context.json({ error: terminalError(created) }, 400);
			terminalPollStates.set(terminalId, { sequence: 0, text: "" });
			return context.json({ sessionId: terminalId }, 201);
		} catch (error) {
			return context.json({ error: error instanceof Error ? error.message : "Could not start terminal." }, 400);
		}
	});

	app.post("/codev/terminal/:terminalId/input", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = terminalInputSchema.safeParse(await context.req.json().catch(() => undefined));
		const worktreeId = worktreeIdSchema.safeParse(context.req.query("worktreeId"));
		if (!parsed.success || !worktreeId.success) return context.json({ error: "Invalid terminal input request." }, 400);
		try {
			const result = await writeFramedInputToSession({ terminalId: context.req.param("terminalId"), workspaceId: hostWorkspaceId(worktreeId.data), text: parsed.data.data, submit: false, db, eventBus });
			if ("error" in result) return context.json({ error: terminalError(result) }, 400);
			return context.json({ ok: true });
		} catch (error) {
			return context.json({ error: error instanceof Error ? error.message : "Could not write terminal input." }, 400);
		}
	});

	app.post("/codev/terminal/:terminalId/resize", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = dimensionsSchema.safeParse(await context.req.json().catch(() => undefined));
		const worktreeId = worktreeIdSchema.safeParse(context.req.query("worktreeId"));
		if (!parsed.success || !worktreeId.success) return context.json({ error: "Invalid terminal resize request." }, 400);
		try {
			const result = await resizeTerminalSession({ terminalId: context.req.param("terminalId"), workspaceId: hostWorkspaceId(worktreeId.data), columns: parsed.data.columns, rows: parsed.data.rows, db, eventBus });
			if ("error" in result) return context.json({ error: terminalError(result) }, 400);
			return context.json({ ok: true });
		} catch (error) {
			return context.json({ error: error instanceof Error ? error.message : "Could not resize terminal." }, 400);
		}
	});

	app.post("/codev/terminal/:terminalId/poll", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = terminalPollSchema.safeParse(await context.req.json().catch(() => undefined));
		const worktreeId = worktreeIdSchema.safeParse(context.req.query("worktreeId"));
		if (!parsed.success || !worktreeId.success) return context.json({ error: "Invalid terminal poll request." }, 400);
		try {
			const snapshot = await snapshotSession({ terminalId: context.req.param("terminalId"), workspaceId: hostWorkspaceId(worktreeId.data), maxLines: 1_000, db, eventBus });
			if ("error" in snapshot) return context.json({ error: terminalError(snapshot) }, 400);
			const state = terminalPollStates.get(context.req.param("terminalId")) ?? { sequence: 0, text: "" };
			if (snapshot.text !== state.text) {
				state.sequence += 1;
				state.text = snapshot.text;
				terminalPollStates.set(context.req.param("terminalId"), state);
			}
			return context.json({
				chunks: parsed.data.after < state.sequence ? [{ sequence: state.sequence, data: `\u001b[2J\u001b[H${state.text}` }] : [],
				nextSequence: state.sequence,
				exited: false,
				exitCode: null,
			});
		} catch (error) {
			return context.json({ error: error instanceof Error ? error.message : "Could not poll terminal." }, 400);
		}
	});

	app.delete("/codev/terminal/:terminalId", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const worktreeId = worktreeIdSchema.safeParse(context.req.query("worktreeId"));
		if (!worktreeId.success) return context.json({ error: "Invalid terminal close request." }, 400);
		try {
			const terminalId = context.req.param("terminalId");
			const session = db.query.terminalSessions
				.findFirst({ where: eq(terminalSessions.id, terminalId) })
				.sync();
			if (!session || session.originWorkspaceId !== hostWorkspaceId(worktreeId.data)) {
				return context.json({ error: "Terminal session is not in this worktree." }, 400);
			}
			await disposeSessionAndWait(terminalId, db);
			terminalPollStates.delete(terminalId);
			return context.json({ ok: true });
		} catch (error) {
			return context.json({ error: error instanceof Error ? error.message : "Could not close terminal." }, 400);
		}
	});
}
