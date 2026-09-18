import { describe, expect, it } from "vitest";

import {
  CANCELLED_CLAIM_NOTICE,
  CONTESTED_OVERLAP_TITLE,
  claimGroupForPath,
  displayClaimStatus,
  reassignedClaimNotice,
  toPathClaimsSnapshot,
  type PathClaimSource,
} from "./path-claims-view";
import type { WorkboardSession } from "./workboard-view";

const now = new Date("2026-08-15T08:00:00.000Z");

function session(
  overrides: Partial<WorkboardSession> & Pick<WorkboardSession, "id">,
): WorkboardSession {
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
    ...overrides,
  };
}

function claim(
  overrides: Partial<PathClaimSource> &
    Pick<PathClaimSource, "id" | "sessionId">,
): PathClaimSource {
  return {
    pathGlob: "README.md",
    intent: "Prepare an exact write claim",
    revision: "HEAD",
    status: "active",
    expiresAt: "2026-08-15T08:15:00.000Z",
    createdAt: "2026-08-15T07:59:50.000Z",
    ...overrides,
  };
}

describe("path claims view", () => {
  it("maps an active README.md claim onto agent slot 1", () => {
    const snapshot = toPathClaimsSnapshot({
      viewer: { id: "user-1", name: "Jordan Lee", canCoSteer: true },
      sessions: [
        session({
          id: "session-1",
          name: "Repository map",
          ownerName: "Alex Morgan",
        }),
        session({ id: "session-2", name: "Documentation sync" }),
      ],
      claims: [claim({ id: "claim-1", sessionId: "session-1" })],
      now,
    });

    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0]).toMatchObject({
      path: "README.md",
      contested: false,
      warningTitle: null,
      keepClaimId: "claim-1",
      overlappingClaimId: null,
    });
    expect(snapshot.claims[0]).toMatchObject({
      slot: 1,
      assignment: "Repository map",
      owner: "Alex Morgan",
      path: "README.md",
      status: "active",
      displayStatus: "Active",
    });
  });

  it("surfaces a contested overlap with reassign and cancel targets", () => {
    const snapshot = toPathClaimsSnapshot({
      viewer: { id: "user-1", name: "Jordan Lee", canCoSteer: true },
      sessions: [
        session({ id: "session-1", name: "Repository map" }),
        session({ id: "session-2", name: "Documentation sync" }),
      ],
      claims: [
        claim({
          id: "claim-1",
          sessionId: "session-1",
          status: "contested",
        }),
        claim({
          id: "claim-2",
          sessionId: "session-2",
          status: "contested",
          createdAt: "2026-08-15T08:00:10.000Z",
        }),
      ],
      now,
    });

    expect(snapshot.groups[0]).toMatchObject({
      path: "README.md",
      contested: true,
      warningTitle: CONTESTED_OVERLAP_TITLE,
      warningDetail:
        "Agent slot 2 requested README.md, which is already claimed by Agent slot 1. Reassign or cancel before either agent writes.",
      keepClaimId: "claim-1",
      overlappingClaimId: "claim-2",
      reassignSlot: 2,
      reassignClaimId: "claim-2",
    });
    expect(
      snapshot.groups[0]?.claims.map((entry) => entry.displayStatus),
    ).toEqual(["Contested", "Contested"]);
  });

  it("shows released and cancelled rows after reassignment", () => {
    const snapshot = toPathClaimsSnapshot({
      viewer: { id: "user-1", name: "Jordan Lee", canCoSteer: true },
      sessions: [session({ id: "session-1" }), session({ id: "session-2" })],
      claims: [
        claim({
          id: "claim-1",
          sessionId: "session-1",
          status: "released",
        }),
        claim({
          id: "claim-2",
          sessionId: "session-2",
          status: "active",
        }),
      ],
      notice: reassignedClaimNotice(2),
      now,
    });

    expect(snapshot.notice).toBe("Claim reassigned to Agent slot 2");
    expect(
      snapshot.groups[0]?.claims.map((entry) => entry.displayStatus),
    ).toEqual(["Released", "Active"]);
    expect(snapshot.groups[0]?.contested).toBe(false);
  });

  it("marks the overlapping released claim as cancelled", () => {
    expect(
      displayClaimStatus({ id: "claim-2", status: "released" }, [
        { id: "claim-1", status: "active" },
        { id: "claim-2", status: "released" },
      ]),
    ).toBe("Cancelled");
    expect(CANCELLED_CLAIM_NOTICE).toBe("Overlapping claim cancelled");
  });

  it("matches Explorer files to exact and directory claims", () => {
    const snapshot = toPathClaimsSnapshot({
      viewer: { id: "user-1", name: "Jordan Lee", canCoSteer: true },
      sessions: [session({ id: "session-1" })],
      claims: [
        claim({
          id: "claim-dir",
          sessionId: "session-1",
          pathGlob: "docs/**",
        }),
      ],
      now,
    });
    expect(claimGroupForPath(snapshot.groups, "docs/guide.md")?.path).toBe(
      "docs/**",
    );
    expect(claimGroupForPath(snapshot.groups, "README.md")).toBeNull();
  });
});
