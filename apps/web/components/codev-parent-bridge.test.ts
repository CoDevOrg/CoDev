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
      .mockResolvedValueOnce(
        Response.json({
          path: "README.md",
          snapshotRevision: "editor-r1",
          filesystemRevision: "filesystem-r2",
          collaborativeContents: "editor README",
          filesystemContents: "terminal README",
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
          requestId: "req-conflicts-report",
          method: "conflicts.report",
          params: {
            path: "README.md",
            collaborativeContents: "editor README",
          },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        path: "README.md",
        collaborativeContents: "editor README",
        filesystemContents: "terminal README",
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/collaboration/conflicts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "README.md",
          collaborativeContents: "editor README",
        }),
      },
    );
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

  it("lists, queues, interrupts, and starts a controlled shared agent turn", async () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 1 },
    ).session;
    const sessionId = "f3100000-0000-4000-8000-000000000001";
    const snapshot = {
      viewer: { id: "user-1", name: "Jordan Lee", canCoSteer: true },
      sharedSessions: [
        {
          session: {
            sessionId,
            state: "running",
            streamCursor: 2,
            queue: [{ authorId: "user-1", prompt: "Inspect README.md" }],
          },
        },
      ],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(snapshot))
      .mockResolvedValueOnce(Response.json(snapshot))
      .mockResolvedValueOnce(
        Response.json({
          ...snapshot,
          sharedSessions: [
            {
              session: {
                sessionId,
                state: "interrupted",
                streamCursor: 3,
                queue: [{ authorId: "user-1", prompt: "Inspect README.md" }],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json(snapshot));

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-agents-list",
          method: "agents.list",
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true, result: snapshot });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/agents/shared",
      { cache: "no-store" },
    );

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-agents-enqueue",
          method: "agents.enqueue",
          params: { sessionId, prompt: "Inspect README.md" },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/workspaces/workspace-1/agents/${sessionId}/queue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Inspect README.md" }),
      },
    );

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-agents-interrupt",
          method: "agents.interrupt",
          params: { sessionId },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { sharedSessions: [{ session: { state: "interrupted" } }] },
    });

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-agents-controlled",
          method: "agents.startControlled",
          params: { sessionId },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenLastCalledWith(
      `/api/workspaces/workspace-1/agents/${sessionId}/controlled`,
      { method: "POST" },
    );
  });

  it("loads the three-slot workboard and surfaces a fourth-session HTTP 409", async () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 1 },
    ).session;
    const workboard = {
      capacity: { maxActiveSessions: 3, activeSessions: 3, availableSlots: 0 },
      slots: [{ slot: 1 }, { slot: 2 }, { slot: 3 }],
      rejection: null,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(workboard))
      .mockResolvedValueOnce(
        Response.json(
          {
            error:
              "All three agent slots are in use. Stop or wait for an active session to finish before starting another.",
            code: "agent_capacity_exceeded",
          },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(Response.json(workboard));

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-workboard-list",
          method: "workboard.list",
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true, result: workboard });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/agents/workboard",
      { cache: "no-store" },
    );

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-workboard-create",
          method: "workboard.create",
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        created: null,
        rejection: {
          status: 409,
          title: "Server rejected the fourth session · HTTP 409",
          message:
            "All three agent slots are in use. Stop or wait for an active session to finish before starting another.",
        },
      },
    });
    expect(fetcher).toHaveBeenCalledWith("/api/workspaces/workspace-1/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Managed proposal",
        draft: true,
        attachments: [],
      }),
    });
  });

  it("lists, creates, reassigns, and cancels workspace path claims", async () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 1 },
    ).session;
    const sessionId = "aa22f527-8992-4814-95a2-070f1b01fc9f";
    const claimId = "bb33f527-8992-4814-95a2-070f1b01fc9f";
    const snapshot = {
      groups: [{ path: "README.md", contested: true }],
      notice: null,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(snapshot))
      .mockResolvedValueOnce(Response.json(snapshot, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({
          ...snapshot,
          notice: "Claim reassigned to Agent slot 2",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...snapshot,
          notice: "Overlapping claim cancelled",
        }),
      );

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-claims-list",
          method: "claims.list",
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true, result: snapshot });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/agents/claims",
      { cache: "no-store" },
    );

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-claims-create",
          method: "claims.create",
          params: { sessionId, contest: true },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/agents/claims",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, contest: true }),
      },
    );

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-claims-reassign",
          method: "claims.reassign",
          params: { claimId },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { notice: "Claim reassigned to Agent slot 2" },
    });

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-claims-cancel",
          method: "claims.cancel",
          params: { claimId },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { notice: "Overlapping claim cancelled" },
    });
  });

  it("loads and prepares review checkpoints through the workspace-bound request bridge", async () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 1 },
    ).session;
    const sessionId = "aa22f527-8992-4814-95a2-070f1b01fc9f";
    const snapshot = {
      viewer: { id: "user-1", name: "Jordan Lee", canReview: true },
      checkpoints: [
        {
          sessionId,
          prepared: true,
          summary: "2 paths changed · 1 text file · 1 binary file",
          paths: [
            {
              path: "assets/logo.png",
              kind: "binary",
              detail: "Binary file · content omitted",
            },
          ],
        },
      ],
    };
    const stale = {
      ...snapshot,
      approval: { state: "stale", blocked: true, mergeStarted: false },
    };
    const integrated = {
      ...snapshot,
      approval: { state: "integrated", blocked: false, mergeStarted: false },
      integration: {
        actor: "Jordan Lee",
        role: "Maintainer",
        event: "agent.review_merged",
        mergedHeadSha: "d".repeat(40),
      },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(snapshot))
      .mockResolvedValueOnce(Response.json(snapshot))
      .mockResolvedValueOnce(Response.json(stale))
      .mockResolvedValueOnce(Response.json(integrated));

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-review-list",
          method: "review.list",
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true, result: snapshot });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/agents/reviews",
      { cache: "no-store" },
    );

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-review-prepare",
          method: "review.prepare",
          params: { sessionId },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true, result: snapshot });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/agents/reviews",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "prepare", sessionId }),
      },
    );

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-review-advance",
          method: "review.advance",
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true, result: stale });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/agents/reviews",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "advance" }),
      },
    );

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-review-merge",
          method: "review.merge",
          params: { sessionId },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true, result: integrated });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/agents/reviews",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "merge", sessionId }),
      },
    );
    expect(JSON.stringify(snapshot)).not.toContain("diff --git ");
  });

  it("loads the durable activity timeline through the workspace-bound request bridge", async () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 1 },
    ).session;
    const activity = {
      viewer: { id: "user-1", name: "CoDev Test Jordan" },
      filters: { kind: "diff", query: "review_merged" },
      filtered: [
        {
          id: "event-1",
          type: "agent.review_merged",
          summary: "CoDev Test Jordan integrated a reviewed checkpoint",
          jump: {
            kind: "diff",
            surface: "checks",
            label: "Open Checks · diff",
          },
        },
      ],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(activity));

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-activity-list",
          method: "activity.list",
          params: { kind: "diff", query: "review_merged" },
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true, result: activity });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/events?kind=diff&query=review_merged",
      { cache: "no-store" },
    );
  });

  it("loads redacted provider connections through the workspace-bound request bridge", async () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 1 },
    ).session;
    const connections = {
      viewer: { id: "user-1", name: "CoDev Test Jordan" },
      connections: [
        {
          provider: "openai",
          status: "connected",
          lastFour: "9kQ2",
          suppliedBy: "CoDev Test Jordan",
        },
      ],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(connections));

    await expect(
      executeCodevBridgeRequest(
        "workspace-1",
        {
          type: "codev:bridge-request",
          generation: 1,
          requestId: "req-connections-list",
          method: "connections.list",
        },
        connected,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true, result: connections });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/connections",
      { cache: "no-store" },
    );
  });
});
