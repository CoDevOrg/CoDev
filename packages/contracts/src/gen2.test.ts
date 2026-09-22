import { describe, expect, it } from "vitest";

import {
  gen2ContextPreviewSchema,
  gen2MemberConnectionStatusSchema,
  gen2MemberRoleMutationSchema,
} from "./gen2";

describe("Gen 2 Control contracts", () => {
  it("limits member role mutations to editor and viewer", () => {
    expect(gen2MemberRoleMutationSchema.parse({ role: "editor" })).toEqual({
      role: "editor",
    });
    expect(
      gen2MemberRoleMutationSchema.safeParse({ role: "owner" }).success,
    ).toBe(false);
  });

  it("keeps member connection status redacted", () => {
    expect(
      gen2MemberConnectionStatusSchema.parse({
        userId: "11111111-1111-4111-8111-111111111111",
        connected: true,
        via: "subscription",
        token: "secret",
      }),
    ).toEqual({
      userId: "11111111-1111-4111-8111-111111111111",
      connected: true,
    });
  });

  it("publishes the fixed context limits", () => {
    expect(
      gen2ContextPreviewSchema.parse({
        chatId: "11111111-1111-4111-8111-111111111111",
        messageIds: [],
        messageCount: 0,
        maxMessages: 20,
        maxCharacters: 12_000,
      }),
    ).toMatchObject({ maxMessages: 20, maxCharacters: 12_000 });
  });
});
