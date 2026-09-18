import { describe, expect, it, vi } from "vitest";

import {
  parseOrganizationOverride,
  parsePlanAssignment,
  parseUserOverride,
} from "./admin-feature-access-input";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("admin feature access input", () => {
  it("validates plan assignments against stable plan identifiers", () => {
    expect(
      parsePlanAssignment(
        form({ organizationId: ORGANIZATION_ID, planId: "team" }),
      ),
    ).toEqual({ organizationId: ORGANIZATION_ID, planId: "team" });
    expect(() =>
      parsePlanAssignment(
        form({ organizationId: ORGANIZATION_ID, planId: "unlimited" }),
      ),
    ).toThrow();
  });

  it("removes an override without accepting a stale expiry", () => {
    expect(
      parseOrganizationOverride(
        form({
          organizationId: ORGANIZATION_ID,
          feature: "hosted_codex_subscription",
          state: "inherit",
          expiresAt: "not-a-date",
        }),
      ),
    ).toEqual({
      organizationId: ORGANIZATION_ID,
      feature: "hosted_codex_subscription",
      state: "inherit",
      expiresAt: null,
    });
  });

  it("accepts future expiry and rejects expired overrides", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T12:00:00.000Z"));
    const valid = parseUserOverride(
      form({
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        feature: "hosted_codex_subscription",
        state: "enabled",
        expiresAt: "2026-09-14T08:00",
        timezoneOffset: "240",
      }),
    );
    expect(valid.expiresAt).toEqual(new Date("2026-09-14T12:00:00.000Z"));
    expect(() =>
      parseUserOverride(
        form({
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          feature: "hosted_codex_subscription",
          state: "disabled",
          expiresAt: "2026-09-12T08:00",
          timezoneOffset: "240",
        }),
      ),
    ).toThrow("Expiry must be in the future.");
    vi.useRealTimers();
  });
});
