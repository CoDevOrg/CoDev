import { afterEach, describe, expect, it } from "bun:test";
import { COORDINATION_HOOK_COMMAND } from "./agent-isolation";

const TOKEN = "test-hook-token";
let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
	server?.stop(true);
	server = undefined;
});

async function runHook(env: Record<string, string>) {
	const child = Bun.spawn(["/bin/sh", "-c", COORDINATION_HOOK_COMMAND], {
		env: { PATH: process.env.PATH ?? "", ...env },
		stdin: new Blob(['{"hook_event_name":"PostToolUse"}']),
		stdout: "pipe",
	});
	const stdout = await new Response(child.stdout).text();
	return { status: await child.exited, stdout };
}

function hookEnv(port: number | undefined) {
	return {
		SUPERSET_HOST_AGENT_HOOK_URL: `http://127.0.0.1:${port}/trpc/notifications.hook`,
		SUPERSET_TERMINAL_ID: "agent-1-1",
		SUPERSET_ACCOUNT_ATTRIBUTION_TOKEN: TOKEN,
	};
}

describe("COORDINATION_HOOK_COMMAND", () => {
	it("posts its terminal with the token header and prints only the reply", async () => {
		const requests: Array<{
			path: string;
			token: string | null;
			body: unknown;
		}> = [];
		server = Bun.serve({
			port: 0,
			async fetch(request) {
				requests.push({
					path: new URL(request.url).pathname,
					token: request.headers.get("x-codev-hook-token"),
					body: await request.json(),
				});
				return Response.json({ additional_context: "notice" });
			},
		});

		const result = await runHook(hookEnv(server.port));

		expect(result.status).toBe(0);
		expect(result.stdout).toBe('{"additional_context":"notice"}');
		expect(requests).toEqual([
			{
				path: "/codev/coordination/notices",
				token: TOKEN,
				body: { agentId: "agent-1-1" },
			},
		]);
		expect(COORDINATION_HOOK_COMMAND).not.toContain(TOKEN);
	});

	it("prints nothing for an empty reply", async () => {
		server = Bun.serve({
			port: 0,
			fetch: () => new Response(null, { status: 204 }),
		});

		const result = await runHook(hookEnv(server.port));

		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("exits cleanly and silently when the host is unreachable, slow, or failing", async () => {
		server = Bun.serve({
			port: 0,
			async fetch(request) {
				if (new URL(request.url).pathname.endsWith("notices")) {
					await new Promise((resolve) => setTimeout(resolve, 2_000));
				}
				return new Response("late", { status: 200 });
			},
		});
		const slow = await runHook(hookEnv(server.port));
		const port = server.port;
		server.stop(true);
		server = Bun.serve({
			port: 0,
			fetch: () => new Response("boom", { status: 500 }),
		});
		const failing = await runHook(hookEnv(server.port));
		server.stop(true);
		server = undefined;
		const unreachable = await runHook(hookEnv(port));

		for (const result of [slow, failing, unreachable]) {
			expect(result.status).toBe(0);
			expect(result.stdout).toBe("");
		}
	});

	it("does nothing outside a CoDev agent terminal", async () => {
		const result = await runHook({});

		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});
});
