import { describe, expect, it } from "vitest";

import {
  parseAccountSubscription,
  parseApplicationAdmin,
  parseOrganizationMemberRole,
} from "./admin-account-access-input";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("admin account access input", () => {
  it("only accepts known organization roles", () => {
    expect(
      parseOrganizationMemberRole(
        form({
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          role: "billing_admin",
        }),
      ),
    ).toMatchObject({ role: "billing_admin" });
    expect(() =>
      parseOrganizationMemberRole(
        form({
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          role: "superuser",
        }),
      ),
    ).toThrow();
  });

  it("accepts only explicit subscription and administrator changes", () => {
    expect(
      parseAccountSubscription(form({ userId: USER_ID, action: "grant" })),
    ).toEqual({
      userId: USER_ID,
      action: "grant",
    });
    expect(
      parseApplicationAdmin(form({ userId: USER_ID, isAdmin: "false" })),
    ).toEqual({
      userId: USER_ID,
      isAdmin: false,
    });
    expect(() =>
      parseAccountSubscription(form({ userId: USER_ID, action: "delete" })),
    ).toThrow();
  });
});
