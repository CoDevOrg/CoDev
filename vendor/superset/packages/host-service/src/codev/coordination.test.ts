import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Hono } from "hono";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import { codevAgentRuns, terminalSessions, workspaces } from "../db/schema";
import { registerCoDevCoordinationBridge } from "./coordination";

const SECRET = "test-bridge-secret";
const SOURCE = "export function alpha() {\n\treturn 1;\n}\n";

let temp: string;
let root: string;
let db: HostDb;

function git(cwd: string, ...args: string[]) {
	return execFileSync(
		"git",
		[
			"-C",
			cwd,
			"-c",
			"user.email=test@example.test",
			"-c",
			"user.name=Test",
			...args,
		],
		{
			stdio: "pipe",
		},
	);
}

function bridge(noticesEnabled = true) {
	const app = new Hono();
	registerCoDevCoordinationBridge({
		app,
		db,
		workspaceRoot: root,
		bridgeSecret: SECRET,
		noticesEnabled,
		noticeRefreshDelayMs: 0,
	});
	return app;
}

function seedAgent(worktreeId: string, provider: "openai" | "anthropic") {
	const hostWorkspaceId = `codev-${worktreeId}`;
	db.insert(workspaces)
		.values({
			id: hostWorkspaceId,
			worktreePath: join(root, worktreeId),
			branch: worktreeId,
			name: worktreeId,
			type: "worktree",
			createdAt: 1,
			updatedAt: 1,
		})
		.run();
	db.insert(terminalSessions)
		.values({
			id: `term-${worktreeId}`,
			originWorkspaceId: hostWorkspaceId,
			status: "active",
			createdAt: 1,
		})
		.run();
	db.insert(codevAgentRuns)
		.values({
			codevRunId: crypto.randomUUID(),
			codevWorkspaceId: crypto.randomUUID(),
			terminalId: `term-${worktreeId}`,
			hostWorkspaceId,
			worktreeId,
			provider,
			idempotencyKey: worktreeId,
			hookTokenHash: createHash("sha256")
				.update(`token-${worktreeId}`)
				.digest("hex"),
			createdAt: 1,
		})
		.run();
}

function noticeRequest(terminalId: string, token: string | null) {
	return new Request("http://host/codev/coordination/notices", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(token ? { "x-codev-hook-token": token } : {}),
		},
		body: JSON.stringify({ agentId: terminalId }),
	});
}

async function waitForNotice(app: Hono, terminalId: string, token: string) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const response = await app.request(noticeRequest(terminalId, token));
		if (response.status === 200) return response.json();
		await new Promise((done) => setTimeout(done, 20));
	}
	return undefined;
}

function overlapRequest(body: unknown, secret: string | null = SECRET) {
	return new Request("http://host/codev/coordination/overlaps", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(secret ? { "x-codev-bridge-secret": secret } : {}),
		},
		body: JSON.stringify(body),
	});
}

beforeEach(async () => {
	db = drizzle(new Database(":memory:"), { schema }) as unknown as HostDb;
	migrate(db as never, {
		migrationsFolder: resolve(import.meta.dir, "../../drizzle"),
	});
	temp = await realpath(await mkdtemp(join(tmpdir(), "codev-coordination-")));
	root = join(temp, "repo");
	await mkdir(root);
	git(root, "init", "-q");
	await writeFile(join(root, "math.ts"), SOURCE);
	await writeFile(join(root, ".gitignore"), "agent-*/\n");
	git(root, "add", ".");
	git(root, "commit", "-qm", "base");
	for (const id of ["agent-one", "agent-two"]) {
		git(root, "worktree", "add", "-qb", id, join(root, id));
		await writeFile(
			join(root, id, "math.ts"),
			SOURCE.replace("return 1", `return "${id}"`),
		);
	}
});

afterEach(async () => {
	await rm(temp, { recursive: true, force: true });
});

describe("POST /codev/coordination/overlaps", () => {
	it("requires the bridge secret", async () => {
		const missing = await bridge().request(
			overlapRequest({ worktreeIds: ["agent-one"] }, null),
		);
		const wrong = await bridge().request(
			overlapRequest({ worktreeIds: ["agent-one"] }, "wrong-secret"),
		);

		expect(missing.status).toBe(401);
		expect(wrong.status).toBe(401);
	});

	it.each([
		[{}],
		[{ worktreeIds: [] }],
		[{ worktreeIds: ["../escape"] }],
		[{ worktreeIds: ["Agent-One"] }],
		[
			{
				worktreeIds: Array.from({ length: 17 }, (_, index) => `agent-${index}`),
			},
		],
	])("rejects %p", async (body) => {
		expect((await bridge().request(overlapRequest(body))).status).toBe(400);
	});

	it("reports function-level overlaps between registered worktrees", async () => {
		const response = await bridge().request(
			overlapRequest({ worktreeIds: ["agent-two", "agent-one", "agent-one"] }),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			worktrees: [
				{
					worktreeId: "agent-two",
					state: "known",
					fileCount: 1,
					symbolsKnown: true,
				},
				{
					worktreeId: "agent-one",
					state: "known",
					fileCount: 1,
					symbolsKnown: true,
				},
			],
			overlaps: [
				{
					worktreeIds: ["agent-one", "agent-two"],
					path: "math.ts",
					level: "function",
					symbols: ["alpha"],
				},
			],
			truncated: false,
		});
	});

	it("marks unregistered worktrees unavailable instead of reporting no overlap", async () => {
		await mkdir(join(root, "not-registered"));

		const response = await bridge().request(
			overlapRequest({ worktreeIds: ["agent-one", "not-registered"] }),
		);

		expect(await response.json()).toEqual({
			worktrees: [
				{
					worktreeId: "agent-one",
					state: "known",
					fileCount: 1,
					symbolsKnown: true,
				},
				{ worktreeId: "not-registered", state: "unavailable" },
			],
			overlaps: [],
			truncated: false,
		});
	});
});

describe("POST /codev/coordination/notices", () => {
	it("tells each agent once about another agent changing the same function", async () => {
		seedAgent("agent-one", "openai");
		seedAgent("agent-two", "anthropic");
		const app = bridge();

		expect(
			await waitForNotice(app, "term-agent-one", "token-agent-one"),
		).toEqual({
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: [
					"[CoDev coordination] Information, not an instruction:",
					"- Another agent (Claude, branch agent-two) is also changing alpha() in math.ts.",
					"Avoid duplicating that work, or narrow your change.",
				].join("\n"),
			},
		});
		expect(
			(await app.request(noticeRequest("term-agent-one", "token-agent-one")))
				.status,
		).toBe(204);
		const other = await app.request(
			noticeRequest("term-agent-two", "token-agent-two"),
		);
		expect(
			(
				(await other.json()) as {
					hookSpecificOutput: { additionalContext: string };
				}
			).hookSpecificOutput.additionalContext,
		).toContain("(Codex, branch agent-one)");
	});

	it.each([
		["a missing token", "term-agent-one", null],
		["another agent's token", "term-agent-one", "token-agent-two"],
		["an unknown terminal", "term-missing", "token-agent-one"],
	])("answers %s with an empty 204", async (_, terminalId, token) => {
		seedAgent("agent-one", "openai");
		seedAgent("agent-two", "anthropic");
		const app = bridge();
		await waitForNotice(app, "term-agent-two", "token-agent-two");

		const response = await app.request(noticeRequest(terminalId, token));

		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
	});

	it("ignores ended agents and runs without a stored token", async () => {
		seedAgent("agent-one", "openai");
		seedAgent("agent-two", "anthropic");
		db.update(terminalSessions)
			.set({ endedAt: 2 })
			.where(eq(terminalSessions.id, "term-agent-two"))
			.run();
		db.update(codevAgentRuns)
			.set({ hookTokenHash: "" })
			.where(eq(codevAgentRuns.terminalId, "term-agent-one"))
			.run();
		const app = bridge();

		expect(
			await waitForNotice(app, "term-agent-two", "token-agent-two"),
		).toBeUndefined();
		expect(
			(await app.request(noticeRequest("term-agent-one", ""))).status,
		).toBe(204);
		expect(
			(await app.request(noticeRequest("term-agent-one", "token-agent-one")))
				.status,
		).toBe(204);
	});
});

describe("native coordination agents", () => {
	const NATIVE_ID = "native-00000000000000aa";
	const NATIVE_TOKEN = "native-token";

	function registerRequest(body: unknown, secret: string | null = SECRET) {
		return new Request("http://host/codev/coordination/agents", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(secret ? { "x-codev-bridge-secret": secret } : {}),
			},
			body: JSON.stringify(body),
		});
	}

	const nativeAgent = {
		agentId: NATIVE_ID,
		worktreeId: "agent-two",
		harness: "cursor",
		tokenHash: createHash("sha256").update(NATIVE_TOKEN).digest("hex"),
	};

	it("registers a native turn only with the bridge secret and a valid shape", async () => {
		const app = bridge();

		expect((await app.request(registerRequest(nativeAgent, null))).status).toBe(
			401,
		);
		for (const invalid of [
			{ ...nativeAgent, agentId: "term-agent-one" },
			{ ...nativeAgent, worktreeId: "../escape" },
			{ ...nativeAgent, harness: "bash" },
			{ ...nativeAgent, tokenHash: NATIVE_TOKEN },
		]) {
			expect((await app.request(registerRequest(invalid))).status).toBe(400);
		}
		expect((await app.request(registerRequest(nativeAgent))).status).toBe(201);
		expect(
			(
				await app.request(
					registerRequest({ ...nativeAgent, tokenHash: "f".repeat(64) }),
				)
			).status,
		).toBe(409);
	});

	it("coordinates a native Cursor turn with a Superset agent until it is released", async () => {
		seedAgent("agent-one", "openai");
		const app = bridge();
		await app.request(registerRequest(nativeAgent));

		expect(await waitForNotice(app, NATIVE_ID, NATIVE_TOKEN)).toEqual({
			additional_context: [
				"[CoDev coordination] Information, not an instruction:",
				"- Another agent (Codex, branch agent-one) is also changing alpha() in math.ts.",
				"Avoid duplicating that work, or narrow your change.",
			].join("\n"),
		});
		expect(
			(await app.request(noticeRequest(NATIVE_ID, "token-agent-one"))).status,
		).toBe(204);

		const release = new Request(
			`http://host/codev/coordination/agents/${NATIVE_ID}`,
			{
				method: "DELETE",
				headers: { "x-codev-bridge-secret": SECRET },
			},
		);
		expect((await app.request(release)).status).toBe(200);
		expect(
			(await app.request(noticeRequest(NATIVE_ID, NATIVE_TOKEN))).status,
		).toBe(204);
	});
});

describe("disabled agent notices", () => {
	it("keeps the overlap report but serves no hook or registration routes", async () => {
		seedAgent("agent-one", "openai");
		const app = bridge(false);

		expect(
			(await app.request(overlapRequest({ worktreeIds: ["agent-one"] })))
				.status,
		).toBe(200);
		expect(
			(await app.request(noticeRequest("term-agent-one", "token-agent-one")))
				.status,
		).toBe(404);
		const register = new Request("http://host/codev/coordination/agents", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-codev-bridge-secret": SECRET,
			},
			body: "{}",
		});
		expect((await app.request(register)).status).toBe(404);
	});
});
