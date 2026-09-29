import { describe, expect, test } from "bun:test";

import { buildCodexLiveSessionOptions } from "./sessions";

describe("buildCodexLiveSessionOptions", () => {
	test("starts a fresh process when an empty session has no harness session id", () => {
		expect(
			buildCodexLiveSessionOptions({
				sessionId: "session-id",
				scopeId: "member-id",
				cwd: "/workspace/main",
				harnessSessionId: null,
			}),
		).toEqual({
			sessionId: "session-id",
			scopeId: "member-id",
			harness: "codex",
			cwd: "/workspace/main",
		});
	});

	test("resumes a session that has a saved harness session id", () => {
		expect(
			buildCodexLiveSessionOptions({
				sessionId: "session-id",
				scopeId: "member-id",
				cwd: "/workspace/feature",
				harnessSessionId: "codex-thread-id",
			}),
		).toEqual({
			sessionId: "session-id",
			scopeId: "member-id",
			harness: "codex",
			cwd: "/workspace/feature",
			resume: { harnessSessionId: "codex-thread-id" },
		});
	});
});
