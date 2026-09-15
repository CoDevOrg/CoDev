import { describe, expect, it, vi } from "vitest";

import {
  refreshWorkspaceProviderPreflight,
  workspaceProviderPreflightFromPayload,
} from "./refresh-workspace-provider-preflight";

describe("workspaceProviderPreflightFromPayload", () => {
  it("returns null for a payload that is not a snapshot", () => {
    expect(workspaceProviderPreflightFromPayload(null)).toBeNull();
    expect(workspaceProviderPreflightFromPayload({})).toBeNull();
  });

  it("derives that nothing can start from an empty snapshot", () => {
    expect(
      workspaceProviderPreflightFromPayload({
        connections: [],
        cliSubscriptions: [],
        claudeCliToken: {
          status: "not_connected",
          lastFour: null,
          enabledForRooms: false,
          enabledForWorkspace: false,
        },
        hostedClaudeConnect: false,
        hostedOpenAIConnect: false,
        viewer: { id: "u1", name: "You" },
      }),
    ).toEqual({
      starting: null,
      startingSource: undefined,
      notReady: [
        { agent: "claude", connectedForRooms: false },
        { agent: "codex", connectedForRooms: false },
      ],
    });
  });
});

describe("refreshWorkspaceProviderPreflight", () => {
  it("recomputes preflight from the personal connections snapshot", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        connections: [
          {
            provider: "anthropic",
            label: "Anthropic",
            status: "connected",
            credentialType: "API_KEY",
            lastFour: "abcd",
            suppliedBy: "You",
            scope: "personal",
            provenance: "api_key",
            enabledForRooms: false,
            enabledForWorkspace: true,
          },
        ],
        cliSubscriptions: [],
        claudeCliToken: {
          status: "not_connected",
          lastFour: null,
          enabledForRooms: false,
          enabledForWorkspace: false,
        },
        hostedClaudeConnect: false,
        hostedOpenAIConnect: false,
        viewer: { id: "u1", name: "You" },
      }),
    );

    await expect(refreshWorkspaceProviderPreflight(fetchImpl)).resolves.toEqual(
      {
        starting: "claude",
        startingSource: "personal",
        notReady: [{ agent: "codex", connectedForRooms: false }],
      },
    );
    expect(fetchImpl).toHaveBeenCalledWith("/api/personal/connections", {
      cache: "no-store",
      credentials: "include",
    });
  });

  it("returns null when the snapshot cannot be loaded", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    await expect(
      refreshWorkspaceProviderPreflight(fetchImpl),
    ).resolves.toBeNull();
  });
});
