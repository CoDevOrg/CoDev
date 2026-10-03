import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { codevAgentRuns } from "../../src/db/schema";
import { type BasicScenario, createBasicScenario } from "../helpers/scenarios";
import { seedTerminalSession } from "../helpers/seed";

describe("notifications.hook integration", () => {
	let scenario: BasicScenario;

	beforeEach(async () => {
		scenario = await createBasicScenario();
	});

	afterEach(async () => {
		await scenario?.dispose();
	});

	test("ignores unknown event types without authentication", async () => {
		const result =
			await scenario.host.unauthenticatedTrpc.notifications.hook.mutate({
				eventType: "garbage",
				terminalId: "terminal-1",
			});
		expect(result).toEqual({ success: true, ignored: true });
	});

	test("ignores hook with missing terminalId", async () => {
		const result =
			await scenario.host.unauthenticatedTrpc.notifications.hook.mutate({
				eventType: "Stop",
			});
		expect(result).toEqual({ success: true, ignored: true });
	});

	test("ignores hook for unknown terminalId", async () => {
		const result =
			await scenario.host.unauthenticatedTrpc.notifications.hook.mutate({
				eventType: "Stop",
				terminalId: "no-such-terminal",
			});
		expect(result).toEqual({ success: true, ignored: true });
	});

	test("broadcasts when terminal session resolves to a workspace", async () => {
		const { id: terminalId } = seedTerminalSession(scenario.host, {
			id: randomUUID(),
			originWorkspaceId: scenario.workspaceId,
		});

		const result =
			await scenario.host.unauthenticatedTrpc.notifications.hook.mutate({
				eventType: "Stop",
				terminalId,
			});
		expect(result).toEqual({ success: true, ignored: false });
	});

	test("requires the launch token before a CoDev hook can bind an agent", async () => {
		const first = seedTerminalSession(scenario.host, {
			id: randomUUID(),
			originWorkspaceId: scenario.workspaceId,
		});
		const second = seedTerminalSession(scenario.host, {
			id: randomUUID(),
			originWorkspaceId: scenario.workspaceId,
		});
		const firstToken = "first-private-token";
		const secondToken = "second-private-token";
		for (const [terminalId, token] of [
			[first.id, firstToken],
			[second.id, secondToken],
		] as const) {
			scenario.host.db
				.insert(codevAgentRuns)
				.values({
					codevRunId: randomUUID(),
					codevWorkspaceId: randomUUID(),
					terminalId,
					hostWorkspaceId: scenario.workspaceId,
					worktreeId: `agent-${terminalId}`,
					provider: "openai",
					idempotencyKey: randomUUID(),
					hookTokenHash: createHash("sha256").update(token).digest("hex"),
				})
				.run();
		}

		const missing = await scenario.host.unauthenticatedTrpc.notifications.hook.mutate({
			eventType: "Start",
			terminalId: first.id,
			agent: { agentId: "codex", sessionId: "first" },
		});
		const replayed = await scenario.host.unauthenticatedTrpc.notifications.hook.mutate({
			eventType: "Start",
			terminalId: second.id,
			attributionToken: firstToken,
			agent: { agentId: "codex", sessionId: "second" },
		});
		expect(missing).toEqual({ success: true, ignored: true });
		expect(replayed).toEqual({ success: true, ignored: true });
		expect(
			scenario.host.db.query.terminalAgentBindings
				.findFirst({ where: (bindings, { eq }) => eq(bindings.terminalId, first.id) })
				.sync(),
		).toBeUndefined();

		const accepted = await scenario.host.unauthenticatedTrpc.notifications.hook.mutate({
			eventType: "Start",
			terminalId: first.id,
			attributionToken: firstToken,
			agent: { agentId: "codex", sessionId: "first" },
		});
		expect(accepted).toEqual({ success: true, ignored: false });
		expect(
			scenario.host.db.query.terminalAgentBindings
				.findFirst({ where: (bindings, { eq }) => eq(bindings.terminalId, first.id) })
				.sync(),
		).toMatchObject({ agentId: "codex", agentSessionId: "first" });
	});
});
