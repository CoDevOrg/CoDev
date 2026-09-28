import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { HostDb } from "../db";
import { terminalSessions, workspaces } from "../db/schema";
import type { EventBus } from "../events";
import {
	createTerminalSessionInternal,
	disposeSessionAndWait,
	snapshotSession,
	writeFramedInputToSession,
} from "../terminal/terminal";
import { resolveCoDevWorktreeRoot } from "./files";

const worktreeIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

const agentStartSchema = z.object({
	worktreeId: worktreeIdSchema,
	provider: z.string().min(1).max(32),
	codexAuthCacheJson: z
		.string()
		.max(128 * 1024)
		.optional(),
	command: z.array(z.string().min(1)).min(1).max(32),
	idempotencyKey: z.string().min(1).max(128),
});
const agentInputSchema = z.object({ data: z.string().max(64 * 1024) });
const agentPollSchema = z.object({ after: z.number().int().nonnegative() });

type GitClient = { raw: (args: string[]) => Promise<string> };
type GitFactory = (worktreePath: string) => Promise<GitClient>;

export type CoDevAgentBridgeOptions = {
	app: Hono;
	db: HostDb;
	eventBus: EventBus;
	git: GitFactory;
	workspaceRoot: string;
	bridgeSecret: string;
};

type AgentPollState = { sequence: number; text: string };
const agentPollStates = new Map<string, AgentPollState>();
/** The private credential profile directory, if one was materialized, keyed by agent ID. */
const agentProfileDirs = new Map<string, string>();
/** idempotencyKey -> agentId, so a retried start reattaches instead of relaunching. */
const agentIdempotency = new Map<string, string>();
let agentSequence = 0;

function secretMatches(actual: string | undefined, expected: string) {
	if (!actual) return false;
	const received = Buffer.from(actual);
	const configured = Buffer.from(expected);
	return received.length === configured.length && timingSafeEqual(received, configured);
}

function hostWorkspaceId(worktreeId: string) {
	return `codev-${worktreeId}`;
}

async function branchAt(git: GitFactory, root: string) {
	const branch = (await (await git(root)).raw(["branch", "--show-current"])).trim();
	return branch || "HEAD";
}

async function ensureAgentWorkspace({
	db,
	git,
	workspaceRoot,
	worktreeId,
}: Pick<CoDevAgentBridgeOptions, "db" | "git" | "workspaceRoot"> & {
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
			name: `CoDev agent ${worktreeId}`,
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
		: "Superset agent operation failed.";
}

/**
 * Quotes one argument for a POSIX shell command line: wrap in single quotes,
 * and turn each embedded `'` into `'\''` (close the quote, an escaped
 * literal quote, reopen the quote). Required because `initialCommand` is
 * typed into a live shell -- an agent's command carries a member's prompt
 * text verbatim (see apps/web's buildGen2CodexCommand), so an unescaped
 * `$()`, backtick, or quote in that text would otherwise run as shell code.
 */
function posixShellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function removeProfileDir(profileDir: string | undefined) {
	if (!profileDir) return;
	await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Fixed, bridge-secret-protected operations that launch and drive a
 * terminal-agent session for CoDev's Superset Agent Session Plan Phase 3.
 * `codev-guestd` forwards a validated request here rather than executing the
 * provider process itself -- see start_superset_agent in guest.rs.
 *
 * There is no headless "run this process" primitive to reuse here: a
 * Superset terminal-agent is an agent CLI running inside a tracked terminal
 * (see terminal-agents/types.ts's TerminalAgentBinding doc comment), so this
 * reuses the same terminal primitives registerCoDevRuntimeBridge's
 * /codev/terminal routes already use -- createTerminalSessionInternal,
 * writeFramedInputToSession, snapshotSession, disposeSessionAndWait -- with
 * the agent's command delivered via `initialCommand` instead of the
 * interactive shell the browser-facing routes start empty.
 *
 * This intentionally does not use terminal-agents/store.ts's
 * TerminalAgentBinding/resume-candidate machinery: that is populated by
 * hook events an agent CLI's own hook configuration reports as it runs, not
 * something this bridge can construct directly. "Recovery" here is instead
 * a liveness check against the terminal session itself (see the /recovery
 * route below) -- real hook-based resume tracking is future work, not part
 * of this phase.
 */
export function registerCoDevAgentBridge({
	app,
	db,
	eventBus,
	git,
	workspaceRoot,
	bridgeSecret,
}: CoDevAgentBridgeOptions) {
	const requireBridge = (request: Request) =>
		secretMatches(request.headers.get("x-codev-bridge-secret") ?? undefined, bridgeSecret);

	app.post("/codev/agents", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = agentStartSchema.safeParse(await context.req.json().catch(() => undefined));
		if (!parsed.success) return context.json({ error: "Invalid Superset agent start request." }, 400);
		const { worktreeId, codexAuthCacheJson, command, idempotencyKey } = parsed.data;

		const existingAgentId = agentIdempotency.get(idempotencyKey);
		if (existingAgentId) {
			const existing = db.query.terminalSessions
				.findFirst({ where: eq(terminalSessions.id, existingAgentId) })
				.sync();
			if (existing && !existing.endedAt) {
				return context.json(
					{
						hostWorkspaceId: existing.originWorkspaceId ?? hostWorkspaceId(worktreeId),
						hostTerminalId: existingAgentId,
						hostAgentSessionId: existingAgentId,
					},
					201,
				);
			}
			agentIdempotency.delete(idempotencyKey);
		}

		let profileDir: string | undefined;
		try {
			const workspace = await ensureAgentWorkspace({ db, git, workspaceRoot, worktreeId });
			let launchCommand = command.map(posixShellQuote).join(" ");
			if (codexAuthCacheJson) {
				const homeRoot = process.env.SUPERSET_HOME_DIR;
				if (!homeRoot) {
					return context.json(
						{ error: "Superset host has no private home directory configured." },
						503,
					);
				}
				profileDir = join(homeRoot, "codev-agent-profiles", randomUUID());
				await mkdir(profileDir, { recursive: true, mode: 0o700 });
				await writeFile(join(profileDir, "auth.json"), codexAuthCacheJson, {
					mode: 0o600,
				});
				launchCommand = `CODEX_HOME=${posixShellQuote(profileDir)} ${launchCommand}`;
			}
			// A one-shot exec must not leave an idle shell behind once the
			// provider process finishes -- exiting lets the terminal
			// subsystem's own PTY-exit handling mark endedAt, which is what
			// /codev/agents/:id/poll and /recovery read.
			launchCommand = `${launchCommand}; exit $?`;

			const agentId = `agent-${Date.now()}-${++agentSequence}`;
			const created = await createTerminalSessionInternal({
				terminalId: agentId,
				workspaceId: workspace.id,
				db,
				eventBus,
				rows: 1_000,
				cols: 4_096,
				includeDefaultAccountEnv: false,
				// Matches /codev/terminal: the image reserves uid/gid 2000 for
				// codev-shell, and setpriv drops directly to it with no PAM
				// session.
				shell: "/usr/bin/setpriv",
				shellArgs: [
					"--reuid=2000",
					"--regid=2000",
					"--clear-groups",
					"--",
					"/bin/sh",
					"-l",
				],
				initialCommand: launchCommand,
			});
			if ("error" in created) {
				await removeProfileDir(profileDir);
				return context.json({ error: terminalError(created) }, 400);
			}
			if (profileDir) agentProfileDirs.set(agentId, profileDir);
			agentIdempotency.set(idempotencyKey, agentId);
			agentPollStates.set(agentId, { sequence: 0, text: "" });
			return context.json(
				{
					hostWorkspaceId: workspace.id,
					hostTerminalId: agentId,
					hostAgentSessionId: agentId,
				},
				201,
			);
		} catch (error) {
			await removeProfileDir(profileDir);
			return context.json(
				{ error: error instanceof Error ? error.message : "Could not start Superset agent." },
				400,
			);
		}
	});

	app.post("/codev/agents/:agentId/input", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = agentInputSchema.safeParse(await context.req.json().catch(() => undefined));
		if (!parsed.success) return context.json({ error: "Invalid Superset agent input request." }, 400);
		const agentId = context.req.param("agentId");
		try {
			const session = db.query.terminalSessions.findFirst({ where: eq(terminalSessions.id, agentId) }).sync();
			if (!session) return context.json({ error: "Superset agent session not found." }, 400);
			const result = await writeFramedInputToSession({
				terminalId: agentId,
				workspaceId: session.originWorkspaceId ?? "",
				text: parsed.data.data,
				submit: false,
				db,
				eventBus,
			});
			if ("error" in result) return context.json({ error: terminalError(result) }, 400);
			return context.json({ ok: true });
		} catch (error) {
			return context.json(
				{ error: error instanceof Error ? error.message : "Could not write Superset agent input." },
				400,
			);
		}
	});

	app.post("/codev/agents/:agentId/poll", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = agentPollSchema.safeParse(await context.req.json().catch(() => undefined));
		if (!parsed.success) return context.json({ error: "Invalid Superset agent poll request." }, 400);
		const agentId = context.req.param("agentId");
		try {
			const session = db.query.terminalSessions.findFirst({ where: eq(terminalSessions.id, agentId) }).sync();
			if (!session) return context.json({ error: "Superset agent session not found." }, 400);
			const snapshot = await snapshotSession({
				terminalId: agentId,
				workspaceId: session.originWorkspaceId ?? "",
				maxLines: 1_000,
				db,
				eventBus,
			});
			if ("error" in snapshot) return context.json({ error: terminalError(snapshot) }, 400);
			const state = agentPollStates.get(agentId) ?? { sequence: 0, text: "" };
			if (snapshot.text !== state.text) {
				state.sequence += 1;
				state.text = snapshot.text;
				agentPollStates.set(agentId, state);
			}
			// The bridge does not expose the underlying process's real exit
			// code (only this package's own terminal.ts tracks it, in
			// memory, on the session object) -- 0 is reported on any
			// detected exit as a reasonable default until that is threaded
			// through.
			const exited = Boolean(session.endedAt);
			return context.json({
				chunks:
					parsed.data.after < state.sequence
						? [{ sequence: state.sequence, data: `\u001b[2J\u001b[H${state.text}` }]
						: [],
				nextSequence: state.sequence,
				exited,
				exitCode: exited ? 0 : null,
				refreshReady: exited,
			});
		} catch (error) {
			return context.json(
				{ error: error instanceof Error ? error.message : "Could not poll Superset agent." },
				400,
			);
		}
	});

	app.delete("/codev/agents/:agentId", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const agentId = context.req.param("agentId");
		try {
			await disposeSessionAndWait(agentId, db);
			agentPollStates.delete(agentId);
			await removeProfileDir(agentProfileDirs.get(agentId));
			agentProfileDirs.delete(agentId);
			return context.json({ ok: true });
		} catch (error) {
			return context.json(
				{ error: error instanceof Error ? error.message : "Could not close Superset agent." },
				400,
			);
		}
	});

	app.get("/codev/agents/:agentId/recovery", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const agentId = context.req.param("agentId");
		try {
			const session = db.query.terminalSessions.findFirst({ where: eq(terminalSessions.id, agentId) }).sync();
			if (!session || session.endedAt) return context.json({ adoptable: false });
			const snapshot = await snapshotSession({
				terminalId: agentId,
				workspaceId: session.originWorkspaceId ?? "",
				maxLines: 1,
				db,
				eventBus,
			});
			return context.json({ adoptable: !("error" in snapshot) });
		} catch {
			return context.json({ adoptable: false });
		}
	});
}
