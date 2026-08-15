import { describe, expect, it } from "vitest";

import {
  formatDiffDigest,
  selectReviewCheckpoint,
  snapshotOmitsRawDiff,
  toReviewSnapshot,
  type ReviewSession,
} from "./review-checkpoint-view";

const now = new Date("2026-08-15T08:00:00.000Z");

function session(
  overrides: Partial<ReviewSession> & Pick<ReviewSession, "id">,
): ReviewSession {
  return {
    name: "Managed proposal",
    provider: "openai",
    status: "idle",
    worktreeId: `worktree-${overrides.id}`,
    worktreeName: `agent-managed-proposal-${overrides.id.slice(0, 8)}`,
    worktreeStatus: "active",
    ownerName: "CoDev Test Jordan",
    ownerLogin: "jordan",
    issueTitle: null,
    createdAt: "2026-08-15T07:59:42.000Z",
    turns: [],
    reviewBaseSha: null,
    reviewHeadSha: null,
    reviewDiffDigest: null,
    ...overrides,
  };
}

const binaryDiff = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,1 +1,2 @@
 hello
+world
diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..3333333
GIT binary patch
literal 12
zcmV-00a&K)0i|tQ
`;

describe("review checkpoint view", () => {
  it("maps prepared checkpoint metadata and a binary-safe diff without raw patch text", () => {
    const snapshot = toReviewSnapshot({
      viewer: { id: "user-1", name: "Jordan Lee", canReview: true },
      sessions: [
        session({
          id: "session-1",
          name: "Repository map",
          worktreeStatus: "frozen",
          reviewBaseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          reviewHeadSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          reviewDiffDigest:
            "3f7a2c8d9b1e4f605a7c9d2e8b6f104c3d5e7a9b1c2d4f608e9a7b5c3d1f2e4a",
        }),
        session({ id: "session-2", name: "Documentation sync" }),
      ],
      diffs: { "worktree-session-1": binaryDiff },
      now,
    });

    expect(snapshot.checkpoints[0]).toMatchObject({
      sessionId: "session-1",
      slot: 1,
      assignment: "Repository map",
      prepared: true,
      baseRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      headRevision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      diffDigest:
        "sha256:3f7a2c8d9b1e4f605a7c9d2e8b6f104c3d5e7a9b1c2d4f608e9a7b5c3d1f2e4a",
      summary: "2 paths changed · 1 text file · 1 binary file",
      additions: 1,
      deletions: 0,
    });
    expect(snapshot.checkpoints[0]?.paths).toEqual([
      { path: "README.md", kind: "modified", detail: "+1 −0 line" },
      {
        path: "assets/logo.png",
        kind: "binary",
        detail: "Binary file · content omitted",
      },
    ]);
    expect(snapshotOmitsRawDiff(snapshot)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("zcmV-00a&K)0i|tQ");
    expect(
      selectReviewCheckpoint(snapshot.checkpoints, "worktree-session-1")?.slot,
    ).toBe(1);
    expect(selectReviewCheckpoint(snapshot.checkpoints, "missing")).toBeNull();
  });

  it("keeps unprepared slots reviewable and prefixes bare digests", () => {
    expect(formatDiffDigest("abc")).toBe("sha256:abc");
    expect(formatDiffDigest("sha256:abc")).toBe("sha256:abc");
    const snapshot = toReviewSnapshot({
      viewer: { id: "user-1", name: "Jordan Lee", canReview: true },
      sessions: [session({ id: "session-1" })],
      now,
    });
    expect(snapshot.checkpoints[0]).toMatchObject({
      prepared: false,
      summary: null,
      paths: [],
    });
  });
});
