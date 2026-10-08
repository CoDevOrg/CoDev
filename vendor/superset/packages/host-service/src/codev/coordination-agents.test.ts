import { describe, expect, it } from "bun:test";
import { createNativeAgentRegistry } from "./coordination-agents";

function agent(hookId: string, hookTokenHash = "a".repeat(64)) {
	return {
		hookId,
		worktreeId: "main",
		harness: "cursor" as const,
		hookTokenHash,
	};
}

describe("createNativeAgentRegistry", () => {
	it("expires a native turn that was never released", () => {
		let clock = 0;
		const registry = createNativeAgentRegistry(() => clock);
		registry.register(agent("native-0000000000000001"));

		clock += 20 * 60_000 - 1;
		expect(registry.list().map((entry) => entry.hookId)).toEqual([
			"native-0000000000000001",
		]);
		clock += 1;
		expect(registry.list()).toEqual([]);
	});

	it("keeps the first token for an agent id and caps the registry", () => {
		const registry = createNativeAgentRegistry(() => 0);
		expect(registry.register(agent("native-0000000000000001"))).toBe(true);
		expect(
			registry.register(agent("native-0000000000000001", "b".repeat(64))),
		).toBe(false);
		for (let index = 2; index <= 32; index += 1) {
			expect(
				registry.register(agent(`native-${String(index).padStart(16, "0")}`)),
			).toBe(true);
		}
		expect(registry.register(agent("native-0000000000000099"))).toBe(false);

		registry.release("native-0000000000000002");
		expect(registry.register(agent("native-0000000000000099"))).toBe(true);
	});
});
