import { describe, expect, it } from "vitest";

import {
  inviteAllowsUser,
  inviteIsAcceptable,
  workspaceInvitePublicStatus,
} from "./workspaces";

const user = { email: "alex@example.com", login: "alex_dev" };

describe("workspace invitation identity checks", () => {
  it("accepts a targeted email case-insensitively", () => {
    expect(
      inviteAllowsUser(
        {
          allowLink: false,
          inviteeEmail: "ALEX@EXAMPLE.COM",
          inviteeLogin: null,
        },
        user,
      ),
    ).toBe(true);
  });

  it("accepts a targeted GitHub handle case-insensitively", () => {
    expect(
      inviteAllowsUser(
        { allowLink: false, inviteeEmail: null, inviteeLogin: "ALEX_DEV" },
        user,
      ),
    ).toBe(true);
  });

  it("rejects a targeted invite issued to another identity", () => {
    expect(
      inviteAllowsUser(
        {
          allowLink: false,
          inviteeEmail: "other@example.com",
          inviteeLogin: "other",
        },
        user,
      ),
    ).toBe(false);
  });

  it("allows a single-use general link without a target", () => {
    expect(
      inviteAllowsUser(
        { allowLink: true, inviteeEmail: null, inviteeLogin: null },
        user,
      ),
    ).toBe(true);
  });
});

describe("workspace invitation acceptance enforcement", () => {
  const now = new Date("2026-08-11T15:00:00.000Z");
  const invite = {
    expiresAt: new Date("2026-08-12T15:00:00.000Z"),
    revokedAt: null,
    acceptedAt: null,
  };

  it("accepts an active invite", () => {
    expect(inviteIsAcceptable(invite, now)).toBe(true);
  });

  it.each([
    ["revoked", { revokedAt: new Date("2026-08-11T14:00:00.000Z") }],
    ["expired", { expiresAt: new Date("2026-08-11T14:59:59.000Z") }],
    ["already accepted", { acceptedAt: new Date("2026-08-11T14:30:00.000Z") }],
  ])("rejects an %s invite", (_label, override) => {
    expect(inviteIsAcceptable({ ...invite, ...override }, now)).toBe(false);
  });
});

describe("workspace invitation public status", () => {
  const now = new Date("2026-08-13T05:00:00.000Z");
  const invite = {
    expiresAt: new Date("2026-08-14T05:00:00.000Z"),
    revokedAt: null as Date | null,
    acceptedAt: null as Date | null,
  };

  it("reports pending, accepted, revoked, and expired states", () => {
    expect(workspaceInvitePublicStatus(invite, now)).toBe("pending");
    expect(
      workspaceInvitePublicStatus(
        { ...invite, acceptedAt: new Date("2026-08-13T04:00:00.000Z") },
        now,
      ),
    ).toBe("accepted");
    expect(
      workspaceInvitePublicStatus(
        { ...invite, revokedAt: new Date("2026-08-13T04:30:00.000Z") },
        now,
      ),
    ).toBe("revoked");
    expect(
      workspaceInvitePublicStatus(
        { ...invite, expiresAt: new Date("2026-08-13T04:59:59.000Z") },
        now,
      ),
    ).toBe("expired");
  });
});
