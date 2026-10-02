// End-to-end test for the CoDev bridge's raw output stream: readTerminalOutput
// and writeRawInputToSession against a real pty-daemon, host DB and shell.
// A mistyped command must come back as the shell's own stderr, typed input must
// reach the shell untouched, and a parked read must return as soon as the shell
// prints. Run with:
//   node --import tsx --test src/terminal/terminal.raw-stream.node-test.ts

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Server } from "@superset/pty-daemon";
import { Hono } from "hono";
import { registerCoDevRuntimeBridge } from "../codev/runtime.ts";
import { createDb, type HostDb } from "../db/index.ts";
import { projects, workspaces } from "../db/schema.ts";
import { disposeDaemonClient } from "./daemon-client-singleton.ts";
import { initTerminalBaseEnv } from "./env.ts";
import {
	__resetSessionsForTesting,
	createTerminalSessionInternal,
	disposeSessionAndWait,
	readTerminalOutput,
	writeRawInputToSession,
} from "./terminal.ts";
import { __setAccountShellForTesting } from "./user-shell.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_HOME = path.join(os.tmpdir(), `host-svc-rawstream-${process.pid}`);
const SOCK = path.join(os.tmpdir(), `host-svc-rawstream-${process.pid}.sock`);
const MIGRATIONS = path.resolve(__dirname, "../../drizzle");

let server: Server;
let db: HostDb;
let workspaceId: string;

before(async () => {
	fs.mkdirSync(TEST_HOME, { recursive: true });
	const worktreePath = path.join(TEST_HOME, "worktree");
	fs.mkdirSync(worktreePath, { recursive: true });

	server = new Server({
		socketPath: SOCK,
		daemonVersion: "0.0.0-rawstream-e2e",
	});
	await server.listen();

	process.env.SUPERSET_PTY_DAEMON_SOCKET = SOCK;
	process.env.SUPERSET_HOME_DIR = TEST_HOME;
	process.env.HOST_SERVICE_VERSION = "0.0.0-rawstream-e2e";
	process.env.NODE_ENV = "development";

	__setAccountShellForTesting("/bin/sh");
	initTerminalBaseEnv({
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		HOME: process.env.HOME ?? TEST_HOME,
		SHELL: "/bin/sh",
	});

	db = createDb(path.join(TEST_HOME, "host.db"), MIGRATIONS);
	const projectId = randomUUID();
	workspaceId = randomUUID();
	db.insert(projects).values({ id: projectId, repoPath: worktreePath }).run();
	db.insert(workspaces)
		.values({ id: workspaceId, projectId, worktreePath, branch: "main" })
		.run();
});

after(async () => {
	__resetSessionsForTesting();
	__setAccountShellForTesting(undefined);
	await disposeDaemonClient();
	await server.close();
	fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

async function open() {
	const terminalId = `e2e-raw-${randomUUID().slice(0, 8)}`;
	const session = await createTerminalSessionInternal({
		terminalId,
		workspaceId,
		db,
	});
	assert.ok(!("error" in session));
	return terminalId;
}

/** Reads until `predicate` holds on everything seen so far, or fails. */
async function readUntil(
	terminalId: string,
	predicate: (text: string) => boolean,
	from = 0,
) {
	let cursor = from;
	let text = "";
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const result = await readTerminalOutput({
			terminalId,
			workspaceId,
			afterSeq: cursor,
			waitMs: 1_000,
			db,
		});
		assert.ok(!("error" in result), "error" in result ? result.error : "");
		if ("error" in result) return { text, cursor };
		text += Buffer.from(result.bytes).toString("utf8");
		cursor = result.nextSeq;
		if (predicate(text)) return { text, cursor };
	}
	assert.fail(`timed out; saw ${JSON.stringify(text)}`);
}

describe("readTerminalOutput / writeRawInputToSession", () => {
	test("a mistyped command comes back as the shell's own error", async () => {
		const terminalId = await open();
		try {
			await readUntil(terminalId, (text) => text.length > 0);
			const written = await writeRawInputToSession({
				terminalId,
				workspaceId,
				data: "definitely_not_a_command_xyz\n",
				db,
			});
			assert.ok(!("error" in written));
			const { text } = await readUntil(terminalId, (seen) =>
				/not found/i.test(seen),
			);
			assert.match(text, /definitely_not_a_command_xyz/);
		} finally {
			await disposeSessionAndWait(terminalId, db);
		}
	});

	test("resuming from the returned position never repeats or drops output", async () => {
		const terminalId = await open();
		try {
			const first = await readUntil(terminalId, (text) => text.length > 0);
			await writeRawInputToSession({
				terminalId,
				workspaceId,
				data: "echo one\n",
				db,
			});
			const second = await readUntil(
				terminalId,
				(text) => /\bone\r?\n/.test(text.replace(/echo one/, "")),
				first.cursor,
			);
			const replay = await readTerminalOutput({
				terminalId,
				workspaceId,
				afterSeq: first.cursor,
				waitMs: 0,
				db,
			});
			assert.ok(!("error" in replay));
			if ("error" in replay) return;
			assert.equal(
				Buffer.from(replay.bytes).toString("utf8").startsWith(second.text.slice(0, 8)),
				true,
			);
			assert.ok(replay.nextSeq >= second.cursor);
		} finally {
			await disposeSessionAndWait(terminalId, db);
		}
	});

	test("a parked read returns as soon as the shell prints, not at the timeout", async () => {
		const terminalId = await open();
		try {
			const settled = await readUntil(terminalId, (text) => text.length > 0);
			// Let the prompt finish arriving, then park with nothing new.
			await new Promise((resolve) => setTimeout(resolve, 500));
			const quiet = await readTerminalOutput({
				terminalId,
				workspaceId,
				afterSeq: settled.cursor,
				waitMs: 0,
				db,
			});
			assert.ok(!("error" in quiet));
			if ("error" in quiet) return;
			const parked = readTerminalOutput({
				terminalId,
				workspaceId,
				afterSeq: quiet.nextSeq,
				waitMs: 20_000,
				db,
			});
			const startedAt = Date.now();
			setTimeout(() => {
				void writeRawInputToSession({
					terminalId,
					workspaceId,
					data: "\n",
					db,
				});
			}, 150);
			const result = await parked;
			assert.ok(!("error" in result));
			if ("error" in result) return;
			assert.ok(result.bytes.byteLength > 0);
			assert.ok(Date.now() - startedAt < 3_000);
		} finally {
			await disposeSessionAndWait(terminalId, db);
		}
	});

	test("reports the exit once the shell is gone", async () => {
		const terminalId = await open();
		await readUntil(terminalId, (text) => text.length > 0);
		await writeRawInputToSession({
			terminalId,
			workspaceId,
			data: "exit 3\n",
			db,
		});
		let cursor = 0;
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline) {
			const result = await readTerminalOutput({
				terminalId,
				workspaceId,
				afterSeq: cursor,
				waitMs: 1_000,
				db,
			});
			assert.ok(!("error" in result));
			if ("error" in result) return;
			cursor = result.nextSeq;
			if (result.exited) {
				assert.equal(result.exitCode, 3);
				return;
			}
		}
		assert.fail("shell exit was never reported");
	});

	test("rejects a terminal from another workspace", async () => {
		const terminalId = await open();
		try {
			const result = await readTerminalOutput({
				terminalId,
				workspaceId: randomUUID(),
				afterSeq: 0,
				waitMs: 0,
				db,
			});
			assert.ok("error" in result);
		} finally {
			await disposeSessionAndWait(terminalId, db);
		}
	});
});

describe("the /codev/terminal bridge over HTTP", () => {
	test("polls raw output with a parked wait, and types into the shell untouched", async () => {
		const root = fs.realpathSync(path.join(TEST_HOME, "worktree"));
		const hostWorkspaceId = "codev-main";
		const now = Date.now();
		db.insert(workspaces)
			.values({
				id: hostWorkspaceId,
				projectId: null,
				worktreePath: root,
				branch: "main",
				name: "CoDev main",
				type: "worktree",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		const app = new Hono();
		registerCoDevRuntimeBridge({
			app,
			db,
			eventBus: { broadcastTerminalLifecycle() {} } as never,
			git: async () => ({ raw: async () => "main\n" }),
			workspaceRoot: root,
			bridgeSecret: "bridge-secret",
		});
		const call = async (route: string, body: unknown) => {
			const response = await app.request(route, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-codev-bridge-secret": "bridge-secret",
				},
				body: JSON.stringify(body),
			});
			return { status: response.status, body: (await response.json()) as any };
		};

		const terminalId = "term-1-1";
		const created = await createTerminalSessionInternal({
			terminalId,
			workspaceId: hostWorkspaceId,
			db,
		});
		assert.ok(!("error" in created));
		try {
			const url = (action: string) =>
				`/codev/terminal/${terminalId}/${action}?worktreeId=main`;

			const unauthorized = await app.request(url("poll"), { method: "POST" });
			assert.equal(unauthorized.status, 401);

			let cursor = 0;
			let text = "";
			const drain = async (until: (seen: string) => boolean) => {
				const deadline = Date.now() + 10_000;
				while (Date.now() < deadline) {
					const polled = await call(url("poll"), {
						after: cursor,
						waitMilliseconds: 1_000,
					});
					assert.equal(polled.status, 200);
					for (const chunk of polled.body.chunks) text += chunk.data;
					cursor = polled.body.nextSequence;
					if (until(text)) return;
				}
				assert.fail(`timed out; saw ${JSON.stringify(text)}`);
			};

			await drain((seen) => seen.length > 0);
			const typed = await call(url("input"), {
				data: "no_such_command_abc\n",
			});
			assert.equal(typed.status, 200);
			await drain((seen) => /not found/i.test(seen));
			assert.match(text, /no_such_command_abc/);
			assert.equal(text.includes("\u001b[2J"), false);
		} finally {
			await disposeSessionAndWait(terminalId, db);
		}
	});
});
