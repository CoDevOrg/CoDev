import { describe, expect, it } from "bun:test";
import { findWorktreeOverlaps } from "./worktree-overlaps";

describe("findWorktreeOverlaps", () => {
	it("reports file and function overlaps once per worktree pair", () => {
		expect(
			findWorktreeOverlaps([
				{
					worktreeId: "fix-auth",
					files: [
						{ path: "src/auth.ts", symbols: ["refreshToken", "login"] },
						{ path: "README.md", symbols: [] },
					],
				},
				{
					worktreeId: "add-rate-limit",
					files: [
						{ path: "src/auth.ts", symbols: ["login"] },
						{ path: "README.md", symbols: [] },
						{ path: "src/limits.ts", symbols: ["limit"] },
					],
				},
			]),
		).toEqual([
			{
				worktreeIds: ["add-rate-limit", "fix-auth"],
				path: "src/auth.ts",
				level: "function",
				symbols: ["login"],
			},
			{
				worktreeIds: ["add-rate-limit", "fix-auth"],
				path: "README.md",
				level: "file",
				symbols: [],
			},
		]);
	});

	it("pairs every worktree that touches the same path", () => {
		const files = [{ path: "src/shared.ts", symbols: [] }];
		const overlaps = findWorktreeOverlaps([
			{ worktreeId: "c", files },
			{ worktreeId: "a", files },
			{ worktreeId: "b", files },
		]);

		expect(overlaps.map((overlap) => overlap.worktreeIds)).toEqual([
			["a", "b"],
			["a", "c"],
			["b", "c"],
		]);
	});

	it("reports nothing for disjoint or single worktrees", () => {
		expect(
			findWorktreeOverlaps([
				{ worktreeId: "a", files: [{ path: "x", symbols: [] }] },
			]),
		).toEqual([]);
		expect(
			findWorktreeOverlaps([
				{ worktreeId: "a", files: [{ path: "x", symbols: [] }] },
				{ worktreeId: "b", files: [{ path: "y", symbols: [] }] },
			]),
		).toEqual([]);
	});
});
