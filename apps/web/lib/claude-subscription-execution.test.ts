import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** `.update().set().where().returning()` — returns `claimed` rows when armed. */
let claimedRows: Array<{ id: string }>;
let lastSet: Record<string, unknown> | null;

const fakeDb = {
  update: () => ({
    set: (patch: Record<string, unknown>) => {
      lastSet = patch;
      return {
        where: () => ({ returning: async () => claimedRows }),
      };
    },
  }),
};

vi.mock("./database", () => ({ getDatabase: () => fakeDb }));

import {
  claimClaudeSubscriptionExecution,
  releaseClaudeSubscriptionExecution,
} from "./claude-subscription-execution";
import { ClaudeConnectionError } from "./claude-connection";

beforeEach(() => {
  claimedRows = [];
  lastSet = null;
});

describe("claimClaudeSubscriptionExecution", () => {
  it("takes the lease when the credential row is free", async () => {
    claimedRows = [{ id: "cred-1" }];
    await claimClaudeSubscriptionExecution("cred-1", "user-1");
    expect(lastSet?.expiresAt).toBeInstanceOf(Date);
  });

  it("throws 429 when the row is already leased or inactive", async () => {
    claimedRows = [];
    await expect(
      claimClaudeSubscriptionExecution("cred-1", "user-1"),
    ).rejects.toMatchObject({
      status: 429,
    });
    await expect(
      claimClaudeSubscriptionExecution("cred-1", "user-1"),
    ).rejects.toBeInstanceOf(ClaudeConnectionError);
  });
});

describe("releaseClaudeSubscriptionExecution", () => {
  it("clears the lease", async () => {
    await releaseClaudeSubscriptionExecution("cred-1", 123456);
    expect(lastSet).toMatchObject({ expiresAt: new Date(0) });
  });
});
