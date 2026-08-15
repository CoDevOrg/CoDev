import { describe, expect, it, vi } from "vitest";

import {
  EMPTY_CODEV_PARENT_BRIDGE_SESSION,
  executeCodevBridgeRequest,
  isCodevBridgeClientMessage,
  isCodevBridgeRequestMessage,
  replyToCodevBridgeMessage,
} from "./codev-parent-bridge";

describe("codev parent bridge", () => {
  it("acks a workspace-bound hello and answers matching pings", () => {
    const hello = replyToCodevBridgeMessage(EMPTY_CODEV_PARENT_BRIDGE_SESSION, {
      type: "codev:bridge-hello",
      generation: 1,
    });

    expect(hello.reply).toEqual({
      type: "codev:bridge-hello-ack",
      generation: 1,
      workspaceBound: true,
    });

    const ping = replyToCodevBridgeMessage(hello.session, {
      type: "codev:bridge-ping",
      generation: 1,
    });
    expect(ping.reply).toEqual({ type: "codev:bridge-pong", generation: 1 });
  });

  it("stops ponging after interrupt until the next hello", () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 2 },
    ).session;
    const interrupted = replyToCodevBridgeMessage(connected, {
      type: "codev:bridge-interrupt",
      generation: 2,
    });

    expect(interrupted.session).toEqual({ open: false, generation: 2 });
    expect(
      replyToCodevBridgeMessage(interrupted.session, {
        type: "codev:bridge-ping",
        generation: 2,
      }).reply,
    ).toBeNull();

    const recovered = replyToCodevBridgeMessage(interrupted.session, {
      type: "codev:bridge-hello",
      generation: 3,
    });
    expect(recovered.reply).toEqual({
      type: "codev:bridge-hello-ack",
      generation: 3,
      workspaceBound: true,
    });
  });

  it("rejects untyped or credential-shaped payloads", () => {
    expect(isCodevBridgeClientMessage({ token: "secret" })).toBe(false);
    expect(
      isCodevBridgeClientMessage({
        type: "codev:bridge-hello",
        generation: 0,
      }),
    ).toBe(false);
    expect(
      isCodevBridgeClientMessage({
        type: "codev:bridge-hello",
        generation: 1,
      }),
    ).toBe(true);
  });

  it("creates and revokes invites through the workspace-bound request bridge", async () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 1 },
    ).session;
    const inviteId = "c1f9fe13-6881-44a6-adbd-96bc5a946afa";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          inviteId,
          inviteUrl: "https://codev.example/invites/token",
          expiresInHours: 24,
          status: "pending",
          members: [
            { login: "alex", name: "Alex Morgan", accessRole: "owner" },
          ],
          invites: [{ inviteId, status: "pending" }],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json({
          members: [
            { login: "alex", name: "Alex Morgan", accessRole: "owner" },
          ],
          invites: [{ inviteId, status: "revoked" }],
        }),
      );

    const created = await executeCodevBridgeRequest(
      "workspace-1",
      {
        type: "codev:bridge-request",
        generation: 1,
        requestId: "req-create",
        method: "invites.create",
        params: { accessRole: "reviewer" },
      },
      connected,
      fetcher,
    );
    expect(created.ok).toBe(true);
    expect(created.result).toMatchObject({
      inviteId,
      status: "pending",
    });

    const revoked = await executeCodevBridgeRequest(
      "workspace-1",
      {
        type: "codev:bridge-request",
        generation: 1,
        requestId: "req-revoke",
        method: "invites.revoke",
        params: { inviteId },
      },
      connected,
      fetcher,
    );
    expect(revoked).toMatchObject({
      ok: true,
      result: {
        revokedInviteId: inviteId,
        invites: [{ inviteId, status: "revoked" }],
        members: [{ login: "alex" }],
      },
    });
    expect(isCodevBridgeRequestMessage({ token: "secret" })).toBe(false);
    expect(
      isCodevBridgeRequestMessage({
        type: "codev:bridge-request",
        generation: 1,
        requestId: "req-1",
        method: "invites.create",
        params: { token: "secret" },
      }),
    ).toBe(false);
  });

  it("updates a member role only through the typed workspace-bound bridge", async () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 1 },
    ).session;
    const memberUserId = "c1f9fe13-6881-44a6-adbd-96bc5a946afa";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        members: [
          {
            userId: memberUserId,
            login: "jordan",
            name: "Jordan Lee",
            accessRole: "viewer",
          },
        ],
      }),
    );

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-member-update",
          method: "members.update",
          params: { memberUserId, accessRole: "viewer" },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { members: [{ login: "jordan", accessRole: "viewer" }] },
    });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/workspaces/workspace-1/members/${memberUserId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessRole: "viewer" }),
      },
    );
    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-invalid-member-update",
          method: "members.update",
          params: { memberUserId: "not-a-member", accessRole: "viewer" },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: "A valid workspace member is required.",
    });
  });

  it("reads and updates active-file presence through the workspace-bound bridge", async () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 1 },
    ).session;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          members: [
            {
              user: { id: "user-1", login: "alex", name: "Alex Morgan" },
              path: "src/hello.ts",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-presence-list",
          method: "presence.list",
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { members: [{ path: "src/hello.ts" }] },
    });
    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-presence-update",
          method: "presence.update",
          params: { path: "README.md" },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenLastCalledWith(
      "/api/workspaces/workspace-1/presence",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "README.md" }),
      },
    );
  });

  it("sends only validated cursor offsets through the workspace-bound bridge", async () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 1 },
    ).session;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-cursor-update",
          method: "presence.cursor.update",
          params: { path: "README.md", cursor: { anchor: 4, head: 18 } },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/presence",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "README.md",
          cursor: { anchor: 4, head: 18 },
        }),
      },
    );
  });

  it("lists and resolves conflicts only through the workspace-bound bridge", async () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 1 },
    ).session;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          conflicts: [{ path: "src/hello.ts", snapshotRevision: "r1" }],
        }),
      )
      .mockResolvedValueOnce(Response.json({ strategy: "collaboration" }));

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-conflicts-list",
          method: "conflicts.list",
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { conflicts: [{ path: "src/hello.ts" }] },
    });
    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-conflicts-resolve",
          method: "conflicts.resolve",
          params: { path: "src/hello.ts", strategy: "collaboration" },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { strategy: "collaboration" },
    });
    expect(fetcher).toHaveBeenLastCalledWith(
      "/api/workspaces/workspace-1/collaboration/conflicts/resolve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "src/hello.ts",
          strategy: "collaboration",
        }),
      },
    );
  });
});
