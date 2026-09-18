import { describe, expect, it } from "vitest";

import { permissionsForSharedChatRole } from "./shared-chat-permissions";

describe("shared chat permissions", () => {
  it("lets owners read, post, and invite", () => {
    expect(permissionsForSharedChatRole("owner")).toEqual({
      read: true,
      post: true,
      invite: true,
    });
  });

  it("lets members read and post but not invite", () => {
    expect(permissionsForSharedChatRole("member")).toEqual({
      read: true,
      post: true,
      invite: false,
    });
  });

  it.each(["unknown", "viewer", "banned"])(
    "denies the unrecognized %s role",
    (role) => {
      expect(permissionsForSharedChatRole(role)).toEqual({
        read: false,
        post: false,
        invite: false,
      });
    },
  );
});
