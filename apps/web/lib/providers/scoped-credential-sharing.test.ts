import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ belongs: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (mocks.belongs() ? [{ userId: "u1" }] : []),
        }),
      }),
    }),
  }),
}));

import { resolvePersonalOrSharedCredential } from "./scoped-credential-sharing";

type FixtureCredential = { id: string };

describe("resolvePersonalOrSharedCredential", () => {
  beforeEach(() => mocks.belongs.mockReset());

  it("prefers the member's own credential over the workspace's shared one", async () => {
    const result = await resolvePersonalOrSharedCredential<FixtureCredential>(
      { userId: "u1", workspaceId: "w1" },
      {
        findPersonal: async () => ({ id: "personal" }),
        findShared: async () => ({ id: "shared" }),
      },
    );
    expect(result).toEqual({
      credential: { id: "personal" },
      source: "USER",
    });
  });

  it("falls back to the workspace's credential only for a member of that workspace", async () => {
    mocks.belongs.mockReturnValue(true);
    const result = await resolvePersonalOrSharedCredential<FixtureCredential>(
      { userId: "u1", workspaceId: "w1" },
      {
        findPersonal: async () => null,
        findShared: async () => ({ id: "shared" }),
      },
    );
    expect(result).toEqual({
      credential: { id: "shared" },
      source: "WORKSPACE",
    });
  });

  it("refuses a shared credential for someone who does not belong to that workspace", async () => {
    mocks.belongs.mockReturnValue(false);
    const result = await resolvePersonalOrSharedCredential<FixtureCredential>(
      { userId: "outsider", workspaceId: "w1" },
      {
        findPersonal: async () => null,
        findShared: async () => ({ id: "shared" }),
      },
    );
    expect(result).toBeNull();
  });

  it("never looks up a shared credential without a workspace id", async () => {
    const findShared = vi.fn();
    const result = await resolvePersonalOrSharedCredential(
      { userId: "u1" },
      { findPersonal: async () => null, findShared },
    );
    expect(result).toBeNull();
    expect(findShared).not.toHaveBeenCalled();
  });
});
