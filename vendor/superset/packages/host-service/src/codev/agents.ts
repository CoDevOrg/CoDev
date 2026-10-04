import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { HostDb } from "../db";
import { getSupervisor } from "../daemon";
import { codevAgentRuns, terminalSessions, workspaces } from "../db/schema";
import type { EventBus } from "../events";
import { agentTerminalLaunchOptions } from "../terminal/agent-launch";
import {
	createTerminalSessionInternal,
	disposeSessionAndWait,
	snapshotSession,
	writeFramedInputToSession,
} from "../terminal/terminal";
import { isApprovedAgentCommand } from "./agent-command-policy";
import {
	type AgentLaunch,
	type AgentLaunchProfile,
	prepareAgentLaunch,
	removeAgentLaunch,
} from "./agent-isolation";
import { resolveCoDevWorktreeRoot } from "./files";

const worktreeIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

const launchProfileSchema = z.object({
	files: z
		.array(
			z.object({
				path: z.string().min(1).max(512),
				contents: z.string().max(128 << 10),
			}),
		)
		.max(8)
		.optional(),
	env: z.record(z.string(), z.string().max(32 << 10)).optional(),
});

const agentStartSchema = z.object({
	codevRunId: z.string().uuid(),
	codevWorkspaceId: z.string().uuid(),
	worktreeId: worktreeIdSchema,
	provider: z.enum(["openai", "anthropic"]),
	launchProfile: launchProfileSchema.optional(),
	codexAuthCacheJson: z
		.string()
		.max(128 * 1024)
		.optional(),
	command: z.array(z.string().max(64 * 1024)).min(1).max(32),
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
type AgentSession = {
	workspaceId: string;
	launch?: AgentLaunch;
};
const agentPollStates = new Map<string, AgentPollState>();
/** The only terminal IDs that this private bridge may operate on. */
const agentSessions = new Map<string, AgentSession>();
/** Exit codes are supplied by the PTY while this host process is alive. */
const agentExitCodes = new Map<string, number>();
let agentSequence = 0;

function secretMatches(actual: string | undefined, expected: string) {
	if (!actual) return false;
	const received = Buffer.from(actual);
	const configured = Buffer.from(expected);
	return received.length === configured.length && timingSafeEqual(received, configured);
}

function newHookToken(): string {
	return randomBytes(32).toString("hex");
}

function hookTokenHash(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

function hostWorkspaceId(worktreeId: string) {
	return `codev-${worktreeId}`;
}

/** Compatibility only for hosts reached through an older control-plane rollout. */
function legacyCodexProfile(authCacheJson: string | undefined): AgentLaunchProfile | undefined {
	if (!authCacheJson) return undefined;
	return {
		files: [{ path: "auth.json", contents: authCacheJson }],
		env: { CODEX_HOME: "{{profileDir}}" },
	};
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

async function releaseAgentLaunch(agentId: string) {
	const session = agentSessions.get(agentId);
	const launch = session?.launch;
	if (session) session.launch = undefined;
	await removeAgentLaunch(launch);
}

function persistedAgentFor(db: HostDb, agentId: string) {
	return db.query.codevAgentRuns
		.findFirst({ where: eq(codevAgentRuns.terminalId, agentId) })
		.sync();
}

function agentMatchesTerminal(
	agent: { hostWorkspaceId: string; worktreeId: string },
	terminal: { originWorkspaceId: string | null },
) {
	return (
		agent.hostWorkspaceId === hostWorkspaceId(agent.worktreeId) &&
		terminal.originWorkspaceId === agent.hostWorkspaceId
	);
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
 * reuses the same agent terminal launch path and terminal primitives
 * registerCoDevRuntimeBridge's
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

	app.get("/codev/agents/activity", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const liveRuns = db.select({ terminalId: codevAgentRuns.terminalId })
			.from(codevAgentRuns)
			.innerJoin(terminalSessions, eq(codevAgentRuns.terminalId, terminalSessions.id))
			.where(isNull(terminalSessions.endedAt)).all();
		if (liveRuns.length === 0) return context.json({ running: false });
		const organizationId = process.env.ORGANIZATION_ID;
		if (!organizationId) return context.json({ running: true, uncertain: true });
		const sessions = await getSupervisor().listSessions(organizationId);
		if (!sessions) return context.json({ running: true, uncertain: true });
		const ids = new Set(liveRuns.map((run) => run.terminalId));
		return context.json({ running: sessions.some((session) =>
			session.alive && ids.has(session.id)) });
	});

	app.post("/codev/agents", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = agentStartSchema.safeParse(await context.req.json().catch(() => undefined));
		if (!parsed.success) return context.json({ error: "Invalid Superset agent start request." }, 400);
		const {
			codevRunId,
			codevWorkspaceId,
			worktreeId,
			provider,
			codexAuthCacheJson,
			launchProfile,
			command,
			idempotencyKey,
		} = parsed.data;
		if (!isApprovedAgentCommand(provider, command)) {
			return context.json({ error: "Unsupported Superset agent launch command." }, 400);
		}

		const existing = db.query.codevAgentRuns
			.findFirst({ where: eq(codevAgentRuns.codevRunId, codevRunId) })
			.sync() ?? db.query.codevAgentRuns
				.findFirst({ where: eq(codevAgentRuns.idempotencyKey, idempotencyKey) })
				.sync();
		if (existing) {
			if (
				existing.codevRunId !== codevRunId ||
				existing.codevWorkspaceId !== codevWorkspaceId ||
				existing.worktreeId !== worktreeId ||
				existing.provider !== provider ||
				existing.idempotencyKey !== idempotencyKey
			) {
				return context.json({ error: "Idempotency key belongs to a different agent launch." }, 409);
			}
			const terminal = db.query.terminalSessions
				.findFirst({ where: eq(terminalSessions.id, existing.terminalId) })
				.sync();
			if (terminal && agentMatchesTerminal(existing, terminal)) {
				return context.json(
					{
						hostWorkspaceId: existing.hostWorkspaceId,
						hostTerminalId: existing.terminalId,
						hostAgentSessionId: existing.terminalId,
					},
					201,
				);
			}
			return context.json({ error: "Agent launch record does not match its terminal." }, 409);
		}

		let launch: AgentLaunch | undefined;
		let agentId: string | undefined;
		try {
			const workspace = await ensureAgentWorkspace({ db, git, workspaceRoot, worktreeId });
			const profileRoot = process.env.CODEV_AGENT_PROFILE_ROOT;
			if (!profileRoot) {
				return context.json({ error: "Isolated agent profiles are not configured." }, 503);
			}
			const hookToken = newHookToken();
			launch = await prepareAgentLaunch({
				root: profileRoot,
				command,
				provider,
				hookToken,
				// A new control plane sends the provider-neutral profile. Keep the
				// Codex cache only as a compatibility fallback for a rolling deploy.
				profile: launchProfile ?? legacyCodexProfile(codexAuthCacheJson),
			});

			const createdAgentId = `agent-${Date.now()}-${++agentSequence}`;
			agentId = createdAgentId;
			const created = await createTerminalSessionInternal(
				agentTerminalLaunchOptions({
					terminalId: createdAgentId,
					workspaceId: workspace.id,
					db,
					eventBus,
					privateProfile: launch,
					initialCommand: launch.command,
				}),
			);
			if ("error" in created) {
				await removeAgentLaunch(launch);
				return context.json({ error: terminalError(created) }, 400);
			}
			db.insert(codevAgentRuns)
				.values({
					codevRunId,
					codevWorkspaceId,
					terminalId: createdAgentId,
					hostWorkspaceId: workspace.id,
					worktreeId,
					provider,
					idempotencyKey,
					hookTokenHash: hookTokenHash(hookToken),
				})
				.run();
			agentSessions.set(createdAgentId, { workspaceId: workspace.id, launch });
			created.pty.onExit(({ exitCode }) => {
				agentExitCodes.set(createdAgentId, exitCode);
				// A natural exit does not pass through DELETE. Remove the private
				// credential profile as soon as its terminal has ended.
				void releaseAgentLaunch(createdAgentId).catch(() => {
					console.error("[codev-agent-bridge] could not remove an isolated launch profile", {
						agentId: createdAgentId,
					});
				});
			});
			agentPollStates.set(createdAgentId, { sequence: 0, text: "" });
			return context.json(
				{
					hostWorkspaceId: workspace.id,
					hostTerminalId: createdAgentId,
					hostAgentSessionId: createdAgentId,
				},
				201,
			);
		} catch (error) {
			if (agentId) await disposeSessionAndWait(agentId, db).catch(() => undefined);
			await removeAgentLaunch(launch);
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
			const agent = persistedAgentFor(db, agentId);
			if (!agent) return context.json({ error: "Superset agent session not found." }, 400);
			const session = db.query.terminalSessions.findFirst({ where: eq(terminalSessions.id, agentId) }).sync();
			if (!session || !agentMatchesTerminal(agent, session)) {
				return context.json({ error: "Superset agent session does not match its launch record." }, 400);
			}
			const result = await writeFramedInputToSession({
				terminalId: agentId,
				workspaceId: agent.hostWorkspaceId,
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
			const agent = persistedAgentFor(db, agentId);
			if (!agent) return context.json({ error: "Superset agent session not found." }, 400);
			const session = db.query.terminalSessions.findFirst({ where: eq(terminalSessions.id, agentId) }).sync();
			if (!session || !agentMatchesTerminal(agent, session)) {
				return context.json({ error: "Superset agent session does not match its launch record." }, 400);
			}
			const snapshot = await snapshotSession({
				terminalId: agentId,
				workspaceId: agent.hostWorkspaceId,
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
			const recordedExitCode = agentExitCodes.get(agentId);
			const exited = Boolean(session.endedAt) || recordedExitCode !== undefined;
			return context.json({
				chunks:
					parsed.data.after < state.sequence
						? [{ sequence: state.sequence, data: `\u001b[2J\u001b[H${state.text}`, dataBase64: Buffer.from(`\u001b[2J\u001b[H${state.text}`, "utf8").toString("base64") }]
						: [],
				nextSequence: state.sequence,
				exited,
				exitCode: exited ? (recordedExitCode ?? null) : null,
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
			const agent = persistedAgentFor(db, agentId);
			if (!agent) return context.json({ error: "Superset agent session not found." }, 400);
			const session = db.query.terminalSessions.findFirst({ where: eq(terminalSessions.id, agentId) }).sync();
			if (!session || !agentMatchesTerminal(agent, session)) {
				return context.json({ error: "Superset agent session does not match its launch record." }, 400);
			}
			await disposeSessionAndWait(agentId, db);
			agentPollStates.delete(agentId);
			await releaseAgentLaunch(agentId);
			agentExitCodes.delete(agentId);
			agentSessions.delete(agentId);
			return context.json({ ok: true });
		} catch (error) {
			return context.json(
				{ error: error instanceof Error ? error.message : "Could not close Superset agent." },
				400,
			);
		}
	});

	app.get("/codev/agents/:agentId/recovery", async (context) => {
		if (!requireBridge(context.req.raw))
			return context.json({ error: "Unauthorized" }, 401);
		const agentId = context.req.param("agentId");
		try {
			const agent = persistedAgentFor(db, agentId);
			if (!agent) return context.json({ adoptable: false, status: "not_found" });
			const session = db.query.terminalSessions
				.findFirst({ where: eq(terminalSessions.id, agentId) })
				.sync();
			if (!session || !agentMatchesTerminal(agent, session))
				return context.json({ adoptable: false, status: "not_found" });
			if (session.endedAt)
				return context.json({
					adoptable: false,
					status: "exited",
					exitCode: agentExitCodes.get(agentId) ?? null,
				});

			const snapshot = await snapshotSession({
				terminalId: agentId,
				workspaceId: agent.hostWorkspaceId,
				maxLines: 1_000,
				db,
				eventBus,
			});
			if ("error" in snapshot) {
				return context.json({ adoptable: false, status: "failed" });
			}

			// Restore and rehydrate the in-memory poll state so subsequent polls
			// can resume seamlessly after a host/VM restart instead of starting from sequence 0.
			const state = agentPollStates.get(agentId) ?? { sequence: 0, text: "" };
			if (snapshot.text !== state.text) {
				state.sequence += 1;
				state.text = snapshot.text;
				agentPollStates.set(agentId, state);
			}

			return context.json({
				adoptable: true,
				status: "running",
				sequence: state.sequence,
				bufferLength: state.text.length,
				worktreeId: agent.worktreeId,
			});
		} catch {
			return context.json({ adoptable: false, status: "failed" });
		}
	});
}
