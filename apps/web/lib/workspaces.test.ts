import { describe, expect, it } from "vitest";

import { inviteAllowsUser } from "./workspaces";

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
