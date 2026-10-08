import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Hono } from "hono";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import { codevAgentRuns, terminalSessions, workspaces } from "../db/schema";
import type { EventBus } from "../events";
import { registerCoDevAgentBridge } from "./agents";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const HOST_WORKSPACE_ID = "codev-agent-one";
const TERMINAL_ID = "agent-one";
const SECRET = "test-bridge-secret";

function createDb(): HostDb {
	const db = drizzle(new Database(":memory:"), { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

function seedRun(db: HostDb, terminalWorkspaceId = HOST_WORKSPACE_ID) {
	db.insert(workspaces)
		.values({
			id: HOST_WORKSPACE_ID,
			worktreePath: "/workspace/agent-one",
			branch: "codev/agent-one",
			name: "CoDev agent one",
			type: "worktree",
			createdAt: 1,
			updatedAt: 1,
		})
		.run();
	db.insert(terminalSessions)
		.values({
			id: TERMINAL_ID,
			originWorkspaceId: terminalWorkspaceId,
			status: "active",
			createdAt: 1,
		})
		.run();
	db.insert(codevAgentRuns)
		.values({
			codevRunId: RUN_ID,
			codevWorkspaceId: WORKSPACE_ID,
			terminalId: TERMINAL_ID,
			hostWorkspaceId: HOST_WORKSPACE_ID,
			worktreeId: "agent-one",
			provider: "openai",
			idempotencyKey: "key-1",
			createdAt: 1,
		})
		.run();
}

function bridge(db: HostDb) {
	const app = new Hono();
	registerCoDevAgentBridge({
		app,
		db,
		eventBus: {} as EventBus,
		git: async () => ({ raw: async () => "" }),
		workspaceRoot: "/workspace",
		bridgeSecret: SECRET,
	});
	return app;
}

function startRequest(overrides: Record<string, unknown> = {}) {
	return new Request("http://host/codev/agents", {
		method: "POST",
		headers: { "content-type": "application/json", "x-codev-bridge-secret": SECRET },
		body: JSON.stringify({
			codevRunId: RUN_ID,
			codevWorkspaceId: WORKSPACE_ID,
			worktreeId: "agent-one",
			provider: "openai",
			command: ["codex", "exec", "--json", "--ephemeral", "--ignore-user-config", "--dangerously-bypass-hook-trust", "--skip-git-repo-check", "--sandbox", "danger-full-access", "-c", 'approval_policy="never"', "--model", "gpt-5", "--cd", ".", "prompt"],
			idempotencyKey: "key-1",
			...overrides,
		}),
	});
}

describe("CoDev agent bridge registration", () => {
	it("reattaches a retry from its persisted terminal registration", async () => {
		const db = createDb();
		seedRun(db);
		const response = await bridge(db).fetch(startRequest());
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			hostWorkspaceId: HOST_WORKSPACE_ID,
			hostTerminalId: TERMINAL_ID,
			hostAgentSessionId: TERMINAL_ID,
		});
	});

	it("rejects a retry that changes its durable worktree identity", async () => {
		const db = createDb();
		seedRun(db);
		const response = await bridge(db).fetch(startRequest({ worktreeId: "agent-two" }));
		expect(response.status).toBe(409);
	});

	it("rejects a persisted run whose terminal belongs to another workspace", async () => {
		const db = createDb();
		seedRun(db, "codev-agent-other");
		const response = await bridge(db).fetch(startRequest());
		expect(response.status).toBe(409);
	});
});

describe("CoDev Cursor agents", () => {
	const cursorCommand = [
		"cursor-agent", "--print", "--output-format", "stream-json", "--force", "--trust",
		"--disable-project-configs", "--model", "composer-2", "prompt",
	];

	it("refuses to launch Cursor beside repository hooks it would run", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "codev-cursor-agent-")));
		try {
			execFileSync("git", ["init", "-q", root]);
			await mkdir(join(root, ".cursor"));
			await writeFile(join(root, ".cursor", "hooks.json"), "{}");
			const app = new Hono();
			registerCoDevAgentBridge({
				app,
				db: createDb(),
				eventBus: {} as EventBus,
				git: async () => ({ raw: async () => "main" }),
				workspaceRoot: root,
				bridgeSecret: SECRET,
			});

			const response = await app.fetch(
				startRequest({ worktreeId: "main", provider: "cursor", command: cursorCommand }),
			);

			expect(response.status).toBe(400);
			expect(((await response.json()) as { error: string }).error).toContain(
				"Cursor would run hooks from .cursor/hooks.json",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a Cursor command outside the approved shape", async () => {
		const response = await bridge(createDb()).fetch(
			startRequest({ provider: "cursor", command: [...cursorCommand.slice(0, 6), ...cursorCommand.slice(7)] }),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Unsupported Superset agent launch command." });
	});
});
