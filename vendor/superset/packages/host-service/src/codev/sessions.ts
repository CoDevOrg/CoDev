import { randomUUID, timingSafeEqual } from "node:crypto";
import {
	chownSync,
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { z } from "zod";
import { isDeltaEnvelope, isDurableEnvelope } from "@superset/chat/protocol";
import {
	CodexAdapter,
	createChatRuntime,
	DEFAULT_MIGRATIONS_FOLDER,
	type ChatRuntime,
	type Subscription,
} from "@superset/chat-runtime";
import { resolveCoDevWorktreeRoot } from "./files";
import { ensureMemberProfilesRoot } from "./member-home-root";

const memberId = z.string().uuid();
const sessionId = z.string().uuid();
const worktreeId = z.string().min(1).max(64).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
const base = z.object({ memberId });
const createInput = base.extend({
	authCacheJson: z.string().min(1).max(256_000),
	worktreeId: worktreeId.default("main"),
});
const target = base.extend({ sessionId });
const eventsInput = target.extend({
	before: z
		.object({ epoch: z.string().min(1), seq: z.number().int().nonnegative() })
		.optional(),
});
const promptInput = target.extend({
	worktreeId: worktreeId.default("main"),
	text: z.string().trim().min(1).max(100_000),
	commandId: z.string().uuid(),
});
const cancelInput = target.extend({
	turnId: z.string().min(1),
	commandId: z.string().uuid(),
});
const approvalInput = target.extend({
	approvalId: z.string().min(1),
	decision: z.discriminatedUnion("type", [
		z.object({ type: z.literal("accept") }),
		z.object({ type: z.literal("accept_for_session") }),
		z.object({ type: z.literal("decline") }),
		z.object({ type: z.literal("cancel") }),
		z.object({ type: z.literal("option"), optionId: z.string().min(1) }),
	]),
	commandId: z.string().uuid(),
});

type UidRegistry = { next: number; members: Record<string, number> };

export function buildCodexLiveSessionOptions(input: {
	sessionId: string;
	scopeId: string;
	cwd: string;
	harnessSessionId?: string | null;
}) {
	return {
		sessionId: input.sessionId,
		scopeId: input.scopeId,
		harness: "codex",
		cwd: input.cwd,
		...(input.harnessSessionId
			? { resume: { harnessSessionId: input.harnessSessionId } }
			: {}),
	};
}

/** Each member gets a separate Codex process uid, auth.json, and chat journal. */
export function registerCoDevSessionBridge(options: {
	app: Hono;
	workspaceRoot: string;
	bridgeSecret: string;
	memberHomeRoot: string;
}) {
	const runtimes = new Map<string, ChatRuntime>();
	const liveText = new Map<
		string,
		{ subscription: Subscription; text: Record<string, string> }
	>();
	const profilesRoot = ensureMemberProfilesRoot(options.memberHomeRoot);
	const registryPath = join(profilesRoot, "uids.json");
	const sessionWorktreesPath = join(profilesRoot, "session-worktrees.json");

	function uidFor(id: string): number {
		const registry: UidRegistry = existsSync(registryPath)
			? (JSON.parse(readFileSync(registryPath, "utf8")) as UidRegistry)
			: { next: 30000, members: {} };
		if (registry.members[id]) return registry.members[id];
		const uid = registry.next++;
		registry.members[id] = uid;
		const temporary = `${registryPath}.${randomUUID()}`;
		writeFileSync(temporary, JSON.stringify(registry), { mode: 0o600 });
		renameSync(temporary, registryPath);
		return uid;
	}

	function profile(id: string) {
		const uid = uidFor(id);
		const directory = join(profilesRoot, id);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		chownSync(directory, uid, 2000);
		chmodSync(directory, 0o700);
		return { uid, directory };
	}

	function sessionWorktrees(id: string): Record<string, string> {
		const all = existsSync(sessionWorktreesPath)
			? (JSON.parse(readFileSync(sessionWorktreesPath, "utf8")) as Record<string, string>)
			: {};
		return Object.fromEntries(Object.entries(all)
			.filter(([key]) => key.startsWith(`${id}:`))
			.map(([key, value]) => [key.slice(id.length + 1), value]));
	}

	function recordSessionWorktree(id: string, session: string, worktree: string) {
		const all = existsSync(sessionWorktreesPath)
			? (JSON.parse(readFileSync(sessionWorktreesPath, "utf8")) as Record<string, string>)
			: {};
		const temporary = `${sessionWorktreesPath}.${randomUUID()}`;
		writeFileSync(temporary, JSON.stringify({ ...all, [`${id}:${session}`]: worktree }), { mode: 0o600 });
		renameSync(temporary, sessionWorktreesPath);
	}

	function runtimeFor(id: string): ChatRuntime {
		const existing = runtimes.get(id);
		if (existing) return existing;
		const { uid, directory } = profile(id);
		const runtime = createChatRuntime({
			dataDir: join(directory, "chat"),
			migrationsFolder:
				process.env.SUPERSET_CHAT_V3_MIGRATIONS ?? DEFAULT_MIGRATIONS_FOLDER,
			harnesses: new Map([
				[
					"codex",
					() =>
						new CodexAdapter({
							command: "setpriv",
							args: [
								"--reuid",
								String(uid),
								"--regid",
								"2000",
								"--groups",
								"2000",
								"codex",
								"app-server",
								"--stdio",
							],
							env: {
								PATH: process.env.PATH,
								LANG: process.env.LANG ?? "C.UTF-8",
								HOME: directory,
								CODEX_HOME: directory,
							},
						}),
				],
			]),
		});
		runtimes.set(id, runtime);
		return runtime;
	}

	function watchSession(runtime: ChatRuntime, id: string) {
		const existing = liveText.get(id);
		if (existing) return existing.text;
		const text: Record<string, string> = Object.create(null);
		const subscription = runtime.subscribe(
			id,
			{ deltas: ["text", "terminal", "tool_input"] },
			{
				send(envelope) {
					if (
						isDurableEnvelope(envelope) &&
						envelope.event.type === "item" &&
						envelope.event.item.completedAtMs
					) {
						delete text[envelope.event.item.id];
						return;
					}
					if (!isDeltaEnvelope(envelope)) return;
					const itemId = envelope.delta.itemId;
					text[itemId] = ((text[itemId] ?? "") + envelope.delta.append).slice(
						-2_000_000,
					);
				},
				close() {},
			},
		);
		liveText.set(id, { subscription, text });
		return text;
	}

	const authorized = (request: Request) => {
		const received = Buffer.from(
			request.headers.get("x-codev-bridge-secret") ?? "",
		);
		const expected = Buffer.from(options.bridgeSecret);
		return (
			received.length === expected.length && timingSafeEqual(received, expected)
		);
	};

	options.app.post("/codev/session/:operation", async (context) => {
		if (!authorized(context.req.raw))
			return context.json({ error: "Unauthorized" }, 401);
		const operation = context.req.param("operation");
		const raw = await context.req.json().catch(() => null);
		const schema =
			operation === "create"
				? createInput
				: operation === "prompt"
					? promptInput
					: operation === "cancel"
						? cancelInput
						: operation === "approve"
							? approvalInput
							: operation === "list"
								? base
								: operation === "events"
									? eventsInput
									: target;
		const parsed = schema.safeParse(raw);
		if (!parsed.success)
			return context.json({ error: "Invalid session request." }, 400);
		const { memberId: id } = parsed.data;
		try {
			const runtime = runtimeFor(id);
			if (operation === "create") {
				const credential = createInput.parse(raw);
				const auth = JSON.parse(credential.authCacheJson) as unknown;
				if (!auth || typeof auth !== "object")
					return context.json({ error: "Invalid Codex credential." }, 400);
				const { uid, directory } = profile(id);
				const authPath = join(directory, "auth.json");
				writeFileSync(authPath, credential.authCacheJson, { mode: 0o600 });
				chownSync(authPath, uid, 2000);
				chmodSync(authPath, 0o600);
				const cwd = await resolveCoDevWorktreeRoot(
					options.workspaceRoot,
					credential.worktreeId,
				);
				const created = runtime.commands.createSession({
					commandId: randomUUID(),
					scopeId: id,
					harness: "codex",
					cwd,
				});
				recordSessionWorktree(id, created.sessionId, credential.worktreeId);
				watchSession(runtime, created.sessionId);
				return context.json({ ...created, worktreeId: credential.worktreeId });
			}
			if (operation === "list") {
				const mapped = sessionWorktrees(id);
				return context.json({
					sessions: runtime.commands.listSessions({ scopeId: id, limit: 100 }).map((session) => ({
						...session,
						worktreeId: mapped[session.sessionId] ?? "main",
					})),
				});
			}
			const input = target.parse(raw);
			const own = runtime.commands.getSession({ sessionId: input.sessionId });
			if (!own.session || own.session.scopeId !== id)
				return context.json({ error: "Session not found." }, 404);
			if (operation === "auth") {
				const { directory } = profile(id);
				return context.json({
					authCacheJson: readFileSync(join(directory, "auth.json"), "utf8"),
				});
			}
			if (operation === "get") return context.json({ ...own, session: { ...own.session, worktreeId: sessionWorktrees(id)[input.sessionId] ?? "main" } });
			if (operation === "events") {
				const query = eventsInput.parse(raw);
				return context.json({
					...runtime.commands.getItems({
						sessionId: input.sessionId,
						before: query.before,
						limit: 500,
					}),
					liveText: watchSession(runtime, input.sessionId),
				});
			}
			if (operation === "prompt") {
				const prompt = promptInput.parse(raw);
				const storedWorktree = sessionWorktrees(id)[prompt.sessionId] ?? "main";
				if (prompt.worktreeId !== storedWorktree)
					return context.json({ error: "Session worktree does not match." }, 409);
				watchSession(runtime, prompt.sessionId);
				if (!runtime.live.get(prompt.sessionId)) {
					const cwd = await resolveCoDevWorktreeRoot(
						options.workspaceRoot,
						storedWorktree,
					);
					runtime.live.create(
						buildCodexLiveSessionOptions({
							sessionId: prompt.sessionId,
							scopeId: id,
							cwd,
							harnessSessionId: own.session.harnessSessionId,
						}),
					);
				}
				return context.json(
					runtime.commands.prompt({
						commandId: prompt.commandId,
						sessionId: prompt.sessionId,
						clientId: prompt.commandId,
						content: [{ type: "text", text: prompt.text }],
					}),
				);
			}
			if (operation === "cancel") {
				const cancel = cancelInput.parse(raw);
				runtime.commands.cancelTurn(cancel);
				return context.json({ ok: true });
			}
			if (operation === "approve") {
				const approval = approvalInput.parse(raw);
				runtime.commands.respondToApproval(approval);
				return context.json({ ok: true });
			}
			return context.json({ error: "Unknown session operation." }, 404);
		} catch (error) {
			return context.json(
				{
					error:
						error instanceof Error
							? error.message
							: "Session operation failed.",
				},
				409,
			);
		}
	});

	return async () => {
		for (const entry of liveText.values()) entry.subscription.unsubscribe();
		liveText.clear();
		await Promise.allSettled(
			[...runtimes.values()].map((runtime) => runtime.dispose()),
		);
	};
}
