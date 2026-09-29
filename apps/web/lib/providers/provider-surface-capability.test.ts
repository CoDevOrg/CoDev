import { describe, expect, it } from "vitest";

import type {
  CliSubscriptionRecord,
  ClaudeCliTokenRecord,
  ProviderConnectionRecord,
  ProviderConnectionSnapshot,
} from "./provider-connection-view";
import {
  providerSurfaceCapability,
  workspaceProviderPreflight,
  workspaceReadyProviders,
} from "./provider-surface-capability";

const OFF: ClaudeCliTokenRecord = {
  status: "not_connected",
  lastFour: null,
  enabledForRooms: false,
  enabledForWorkspace: false,
  allowInSharedWorkspaces: true,
};

function key(
  provider: ProviderConnectionRecord["provider"],
  overrides: Partial<ProviderConnectionRecord> = {},
): ProviderConnectionRecord {
  return {
    provider,
    label: provider,
    status: "connected",
    credentialType: "API_KEY",
    lastFour: "abcd",
    suppliedBy: "You",
    scope: "personal",
    provenance: "api_key",
    enabledForRooms: true,
    enabledForWorkspace: true,
    allowInSharedWorkspaces: true,
    ...overrides,
  };
}

function sub(
  provider: CliSubscriptionRecord["provider"],
  overrides: Partial<CliSubscriptionRecord> = {},
): CliSubscriptionRecord {
  return {
    provider,
    label: provider,
    status: "connected",
    connectMode: "device_code",
    command: null,
    provenance: "browser",
    enabledForRooms: true,
    enabledForWorkspace: true,
    allowInSharedWorkspaces: true,
    ...overrides,
  };
}

function snapshot(
  input: Partial<ProviderConnectionSnapshot> = {},
): ProviderConnectionSnapshot {
  return {
    viewer: { id: "u1", name: "You" },
    connections: [],
    cliSubscriptions: [],
    claudeCliToken: OFF,
    hostedClaudeConnect: true,
    hostedOpenAIConnect: false,
    ...input,
  };
}

describe("providerSurfaceCapability", () => {
  it("a Codex browser subscription powers rooms and workspaces", () => {
    const capability = providerSurfaceCapability(
      snapshot({ cliSubscriptions: [sub("codex")] }),
      "openai",
    );
    expect(capability.rooms).toEqual({ ready: true, via: ["browser"] });
    expect(capability.workspace).toEqual({
      ready: true,
      via: ["browser"],
      source: "personal",
    });
  });

  it("a Claude login powers both surfaces, however it was made", () => {
    // It used to matter: a browser sign-in left a profile in a snapshot that
    // only rooms could reach, and the terminal upload produced a token only
    // workspaces could use. Both capture the same setup-token now.
    for (const provenance of ["browser", "cli"] as const) {
      const view = snapshot({
        cliSubscriptions: [sub("claude", { provenance })],
        claudeCliToken: {
          status: "connected",
          lastFour: "wxyz",
          enabledForRooms: true,
          enabledForWorkspace: true,
          allowInSharedWorkspaces: true,
        },
      });
      const capability = providerSurfaceCapability(view, "anthropic");
      expect(capability.rooms.ready).toBe(true);
      expect(capability.workspace.ready).toBe(true);
    }
  });

  it("a Cursor login powers workspaces only", () => {
    // Rooms run Claude and Codex; `roomReplyOptions` has never offered
    // Cursor, though the old capability table reported it as rooms-ready.
    const view = snapshot({
      cliSubscriptions: [sub("cursor", { provenance: "browser" })],
    });
    const capability = providerSurfaceCapability(view, "cursor");
    expect(capability.rooms.ready).toBe(false);
    expect(capability.workspace.ready).toBe(true);
  });

  it("a local-CLI Codex login powers both surfaces", () => {
    const capability = providerSurfaceCapability(
      snapshot({ cliSubscriptions: [sub("codex", { provenance: "cli" })] }),
      "openai",
    );
    expect(capability.rooms).toEqual({ ready: true, via: ["cli"] });
    expect(capability.workspace).toEqual({
      ready: true,
      via: ["cli"],
      source: "personal",
    });
  });

  it("an API key powers a workspace", () => {
    const capability = providerSurfaceCapability(
      snapshot({ connections: [key("anthropic")] }),
      "anthropic",
    );
    expect(capability.workspace).toEqual({
      ready: true,
      via: ["api_key"],
      source: "personal",
    });
  });

  it("reports rooms readiness from the Claude setup-token", () => {
    // The inverse of this assertion was the bug that started the cleanup:
    // the token was advertised for rooms that could not run it. Rooms run it
    // now — an ephemeral sandbox with the token in its launch profile — so
    // the claim is true rather than removed.
    const view = snapshot({
      cliSubscriptions: [sub("claude", { status: "not_connected" })],
      claudeCliToken: {
        status: "connected",
        lastFour: "wxyz",
        enabledForRooms: true,
        enabledForWorkspace: true,
        allowInSharedWorkspaces: true,
      },
    });
    const capability = providerSurfaceCapability(view, "anthropic");
    expect(capability.rooms.ready).toBe(true);
    expect(capability.workspace.ready).toBe(true);
  });

  it("an API key alone cannot answer in chat rooms", () => {
    // The rooms executor runs only the subscription forms, so a key is a
    // workspace credential no matter which settings section it was pasted in.
    const view = snapshot({ connections: [key("openai")] });
    const capability = providerSurfaceCapability(view, "openai");
    expect(capability.rooms.ready).toBe(false);
    expect(capability.workspace).toEqual({
      ready: true,
      via: ["api_key"],
      source: "personal",
    });
  });

  it("falls back to the workspace's shared org login when the member has no personal one", () => {
    const capability = providerSurfaceCapability(
      snapshot({ sharedWorkspaceLogin: { anthropic: true, openai: false } }),
      "anthropic",
    );
    expect(capability.workspace).toEqual({
      ready: true,
      via: ["cli"],
      source: "shared",
    });
  });

  it("prefers the member's own workspace login over the shared one", () => {
    const capability = providerSurfaceCapability(
      snapshot({
        connections: [key("anthropic")],
        sharedWorkspaceLogin: { anthropic: true, openai: false },
      }),
      "anthropic",
    );
    expect(capability.workspace).toMatchObject({ source: "personal" });
  });

  it("a disconnected provider is ready nowhere", () => {
    const capability = providerSurfaceCapability(
      snapshot({
        connections: [key("openai", { status: "not_connected" })],
        cliSubscriptions: [sub("codex", { status: "not_connected" })],
      }),
      "openai",
    );
    expect(capability.rooms.ready).toBe(false);
    expect(capability.workspace.ready).toBe(false);
  });
});

describe("workspaceReadyProviders", () => {
  it("lists only providers the shared host can actually run, Claude first", () => {
    const view = snapshot({
      connections: [key("openai")],
      cliSubscriptions: [
        sub("claude", { provenance: "browser", enabledForWorkspace: false }),
      ],
      claudeCliToken: {
        status: "connected",
        lastFour: "wxyz",
        enabledForRooms: false,
        enabledForWorkspace: true,
        allowInSharedWorkspaces: true,
      },
    });
    expect(workspaceReadyProviders(view)).toEqual(["anthropic", "openai"]);
  });

  it("lists both agents once each is connected", () => {
    expect(
      workspaceReadyProviders(
        snapshot({
          cliSubscriptions: [sub("codex"), sub("claude")],
          claudeCliToken: {
            status: "connected",
            lastFour: "wxyz",
            enabledForRooms: true,
            enabledForWorkspace: true,
            allowInSharedWorkspaces: true,
          },
        }),
      ),
    ).toEqual(["anthropic", "openai"]);
  });
});

describe("workspaceProviderPreflight", () => {
  /** The original bug: a browser Claude subscription and nothing else. */
  it("names both agents when nothing is connected", () => {
    // `connectedForRooms` used to distinguish Claude's rooms-only browser
    // login from its workspace-only token. One login runs in both places
    // now, so an agent is either usable or not connected at all.
    const preflight = workspaceProviderPreflight(snapshot({}));
    expect(preflight.starting).toBeNull();
    expect(preflight.notReady).toEqual([
      { agent: "claude", connectedForRooms: false },
      { agent: "codex", connectedForRooms: false },
    ]);
  });

  it("starts the connected agent and flags the one that is missing", () => {
    const preflight = workspaceProviderPreflight(
      snapshot({ connections: [key("openai")] }),
    );
    expect(preflight.starting).toBe("codex");
    expect(preflight.notReady).toEqual([
      { agent: "claude", connectedForRooms: false },
    ]);
  });

  it("prefers Claude when both can run", () => {
    const preflight = workspaceProviderPreflight(
      snapshot({ connections: [key("openai"), key("anthropic")] }),
    );
    expect(preflight.starting).toBe("claude");
    expect(preflight.notReady).toEqual([]);
  });

  it("reports starting on the workspace's shared login when the member has no personal one", () => {
    const preflight = workspaceProviderPreflight(
      snapshot({ sharedWorkspaceLogin: { anthropic: true, openai: false } }),
    );
    expect(preflight.starting).toBe("claude");
    expect(preflight.startingSource).toBe("shared");
  });
});
