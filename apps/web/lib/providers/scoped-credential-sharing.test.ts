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

import {
  defaultSharingEnabled,
  resolvePersonalOrSharedCredential,
} from "./scoped-credential-sharing";

describe("defaultSharingEnabled", () => {
  it("is true for an ORGANIZATION scope, false for USER", () => {
    expect(defaultSharingEnabled("ORGANIZATION")).toBe(true);
    expect(defaultSharingEnabled("USER")).toBe(false);
  });
});

type FixtureCredential = { id: string; sharingEnabled: boolean };

describe("resolvePersonalOrSharedCredential", () => {
  beforeEach(() => mocks.belongs.mockReset());

  it("prefers the member's own credential over the workspace's shared one", async () => {
    const result = await resolvePersonalOrSharedCredential<FixtureCredential>(
      { userId: "u1", workspaceId: "w1" },
      {
        findPersonal: async () => ({ id: "personal", sharingEnabled: false }),
        findShared: async () => ({ id: "shared", sharingEnabled: true }),
      },
    );
    expect(result).toEqual({
      credential: { id: "personal", sharingEnabled: false },
      source: "USER",
    });
  });

  it("falls back to the shared credential only when it is marked shared and the member belongs to that workspace", async () => {
    mocks.belongs.mockReturnValue(true);
    const result = await resolvePersonalOrSharedCredential<FixtureCredential>(
      { userId: "u1", workspaceId: "w1" },
      {
        findPersonal: async () => null,
        findShared: async () => ({ id: "shared", sharingEnabled: true }),
      },
    );
    expect(result).toEqual({
      credential: { id: "shared", sharingEnabled: true },
      source: "ORGANIZATION",
    });
  });

  it("refuses a shared credential that was not marked shared, even for a member", async () => {
    mocks.belongs.mockReturnValue(true);
    const result = await resolvePersonalOrSharedCredential<FixtureCredential>(
      { userId: "u1", workspaceId: "w1" },
      {
        findPersonal: async () => null,
        findShared: async () => ({ id: "shared", sharingEnabled: false }),
      },
    );
    expect(result).toBeNull();
  });

  it("refuses a shared credential for someone who does not belong to that workspace", async () => {
    mocks.belongs.mockReturnValue(false);
    const result = await resolvePersonalOrSharedCredential<FixtureCredential>(
      { userId: "outsider", workspaceId: "w1" },
      {
        findPersonal: async () => null,
        findShared: async () => ({ id: "shared", sharingEnabled: true }),
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
