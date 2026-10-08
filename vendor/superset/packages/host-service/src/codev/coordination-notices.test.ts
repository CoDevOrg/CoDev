import { describe, expect, it } from "bun:test";
import type { ChangedFile } from "./change-set";
import {
	createCoordinationNotices,
	type LiveAgent,
	MAX_NOTICES_PER_RUN,
} from "./coordination-notices";

const ONE: LiveAgent = {
	agentKey: "run-one",
	worktreeId: "agent-one",
	harness: "codex",
};
const TWO: LiveAgent = {
	agentKey: "run-two",
	worktreeId: "agent-two",
	harness: "claude",
};

function engine(files: Record<string, ChangedFile[]>, agents = [ONE, TWO]) {
	let clock = 1_000;
	let reads = 0;
	const notices = createCoordinationNotices({
		listLiveAgents: () => agents,
		readWorktree: async (worktreeId) => {
			reads += 1;
			const changed = files[worktreeId];
			return changed
				? {
						changes: { state: "known", files: changed, symbolsKnown: true },
						branch: worktreeId,
					}
				: { changes: undefined, branch: undefined };
		},
		refreshDelayMs: 0,
		now: () => clock,
	});
	return {
		notices,
		advance: (ms: number) => {
			clock += ms;
		},
		reads: () => reads,
	};
}

describe("createCoordinationNotices", () => {
	it("says nothing before the first snapshot", () => {
		const { notices } = engine({
			"agent-one": [{ path: "a.ts", symbols: [] }],
		});

		expect(notices.take(ONE, [ONE, TWO])).toBeUndefined();
	});

	it("tells each agent about an overlap once, naming the other agent", async () => {
		const { notices } = engine({
			"agent-one": [{ path: "a.ts", symbols: ["login"] }],
			"agent-two": [{ path: "a.ts", symbols: ["login"] }],
		});
		await notices.refresh();

		expect(notices.take(ONE, [ONE, TWO])).toEqual({
			notices: [
				{
					path: "a.ts",
					symbols: ["login"],
					provider: "claude",
					branch: "agent-two",
				},
			],
			unlisted: 0,
		});
		expect(notices.take(ONE, [ONE, TWO])).toBeUndefined();
		expect(notices.take(TWO, [ONE, TWO])?.notices[0]?.provider).toBe("codex");
	});

	it("repeats an overlap only when it widens from file to function level", async () => {
		const files: Record<string, ChangedFile[]> = {
			"agent-one": [{ path: "a.ts", symbols: ["login"] }],
			"agent-two": [{ path: "a.ts", symbols: [] }],
		};
		const { notices } = engine(files);
		await notices.refresh();
		expect(notices.take(ONE, [ONE, TWO])?.notices[0]?.symbols).toEqual([]);

		files["agent-two"] = [{ path: "a.ts", symbols: ["login"] }];
		await notices.refresh();
		expect(notices.take(ONE, [ONE, TWO])?.notices[0]?.symbols).toEqual([
			"login",
		]);

		files["agent-two"] = [{ path: "a.ts", symbols: [] }];
		await notices.refresh();
		expect(notices.take(ONE, [ONE, TWO])).toBeUndefined();
	});

	it("sends function-level overlaps first, three per reply", async () => {
		const shared = ["a", "b", "c", "d"].map((name) => ({
			path: `${name}.ts`,
			symbols: [] as string[],
		}));
		const { notices } = engine({
			"agent-one": [...shared, { path: "f.ts", symbols: ["run"] }],
			"agent-two": [...shared, { path: "f.ts", symbols: ["run"] }],
		});
		await notices.refresh();

		const first = notices.take(ONE, [ONE, TWO]);
		expect(first?.notices.map((notice) => notice.path)).toEqual([
			"f.ts",
			"a.ts",
			"b.ts",
		]);
		expect(first?.unlisted).toBe(0);
		expect(
			notices.take(ONE, [ONE, TWO])?.notices.map((notice) => notice.path),
		).toEqual(["c.ts", "d.ts"]);
	});

	it("stops at the per-run cap and reports what it did not list", async () => {
		const shared = Array.from(
			{ length: MAX_NOTICES_PER_RUN + 5 },
			(_, index) => ({
				path: `${index}.ts`,
				symbols: [] as string[],
			}),
		);
		const { notices } = engine({ "agent-one": shared, "agent-two": shared });
		await notices.refresh();

		const replies = Array.from({ length: 10 }, () =>
			notices.take(ONE, [ONE, TWO]),
		).filter(Boolean);

		expect(replies.flatMap((reply) => reply?.notices ?? [])).toHaveLength(
			MAX_NOTICES_PER_RUN,
		);
		expect(replies.at(-1)?.unlisted).toBe(5);
	});

	it("ignores agents in the same worktree and agents that are no longer live", async () => {
		const sameWorktree: LiveAgent = {
			...TWO,
			agentKey: "run-three",
			worktreeId: "agent-one",
		};
		const { notices } = engine(
			{
				"agent-one": [{ path: "a.ts", symbols: [] }],
				"agent-two": [{ path: "a.ts", symbols: [] }],
			},
			[ONE, TWO],
		);
		await notices.refresh();

		expect(notices.take(ONE, [ONE, sameWorktree])).toBeUndefined();
	});

	it("does not use a snapshot older than a minute", async () => {
		const { notices, advance } = engine({
			"agent-one": [{ path: "a.ts", symbols: [] }],
			"agent-two": [{ path: "a.ts", symbols: [] }],
		});
		await notices.refresh();
		advance(60_001);

		expect(notices.take(ONE, [ONE, TWO])).toBeUndefined();
	});

	it("collapses refresh requests into one background read per worktree", async () => {
		const { notices, reads } = engine({
			"agent-one": [{ path: "a.ts", symbols: [] }],
			"agent-two": [{ path: "a.ts", symbols: [] }],
		});
		notices.requestRefresh();
		notices.requestRefresh();
		notices.requestRefresh();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(reads()).toBe(2);
		expect(notices.take(ONE, [ONE, TWO])?.notices).toHaveLength(1);
	});
});
