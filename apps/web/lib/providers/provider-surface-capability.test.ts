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

  it("the Claude browser runtime powers rooms only", () => {
    const view = snapshot({
      cliSubscriptions: [sub("claude", { provenance: "browser" })],
    });
    const capability = providerSurfaceCapability(view, "anthropic");
    expect(capability.rooms).toEqual({ ready: true, via: ["browser"] });
    expect(capability.workspace.ready).toBe(false);
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

  it("the Claude CLI setup-token is a second, workspace-capable login", () => {
    const view = snapshot({
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
    const capability = providerSurfaceCapability(view, "anthropic");
    expect(capability.rooms.via).toEqual(["browser"]);
    expect(capability.workspace).toEqual({
      ready: true,
      via: ["cli"],
      source: "personal",
    });
  });

  it("does not report rooms readiness from the Claude setup-token alone", () => {
    // The rooms executor resolves Claude only through the browser runtime, so
    // a member whose sole Claude login is `codev claude-auth` must not be told
    // rooms are ready — every reply would fail with "Reconnect Claude".
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
    expect(capability.rooms).toEqual({ ready: false, via: [] });
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

  it("lists Codex when the member connected it in the browser", () => {
    expect(
      workspaceReadyProviders(
        snapshot({ cliSubscriptions: [sub("codex"), sub("claude")] }),
      ),
    ).toEqual(["openai"]);
  });
});

describe("workspaceProviderPreflight", () => {
  /** The original bug: a browser Claude subscription and nothing else. */
  it("names the agent that cannot run and that it is rooms-only", () => {
    const preflight = workspaceProviderPreflight(
      snapshot({
        cliSubscriptions: [
          sub("claude", { provenance: "browser", enabledForWorkspace: false }),
        ],
      }),
    );
    expect(preflight.starting).toBeNull();
    expect(preflight.notReady).toEqual([
      { agent: "claude", connectedForRooms: true },
      { agent: "codex", connectedForRooms: false },
    ]);
  });

  it("starts a workspace-ready agent and flags a rooms-only one", () => {
    const preflight = workspaceProviderPreflight(
      snapshot({
        connections: [key("openai")],
        cliSubscriptions: [
          sub("claude", { provenance: "browser", enabledForWorkspace: false }),
        ],
      }),
    );
    expect(preflight.starting).toBe("codex");
    expect(preflight.notReady).toEqual([
      { agent: "claude", connectedForRooms: true },
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
