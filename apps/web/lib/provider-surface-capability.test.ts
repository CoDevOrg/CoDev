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
    ...input,
  };
}

describe("providerSurfaceCapability", () => {
  it("a browser subscription powers rooms only, for every provider", () => {
    const view = snapshot({
      cliSubscriptions: [
        sub("codex", { provenance: "browser" }),
        sub("claude", { provenance: "browser", enabledForWorkspace: false }),
        sub("cursor", { provenance: "browser" }),
      ],
    });
    for (const provider of ["openai", "anthropic", "cursor"] as const) {
      const capability = providerSurfaceCapability(view, provider);
      expect(capability.rooms).toEqual({ ready: true, via: ["browser"] });
      expect(capability.workspace.ready).toBe(false);
    }
  });

  it("a local-CLI Codex login powers both surfaces", () => {
    const capability = providerSurfaceCapability(
      snapshot({ cliSubscriptions: [sub("codex", { provenance: "cli" })] }),
      "openai",
    );
    expect(capability.rooms).toEqual({ ready: true, via: ["cli"] });
    expect(capability.workspace).toEqual({ ready: true, via: ["cli"] });
  });

  it("an API key powers a workspace", () => {
    const capability = providerSurfaceCapability(
      snapshot({ connections: [key("anthropic")] }),
      "anthropic",
    );
    expect(capability.workspace).toEqual({ ready: true, via: ["api_key"] });
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
      },
    });
    const capability = providerSurfaceCapability(view, "anthropic");
    expect(capability.rooms.via).toEqual(["browser"]);
    expect(capability.workspace).toEqual({ ready: true, via: ["cli"] });
  });

  it("honours the member's per-surface toggles", () => {
    const view = snapshot({
      connections: [key("openai", { enabledForWorkspace: false })],
      cliSubscriptions: [
        sub("codex", { provenance: "cli", enabledForRooms: false }),
      ],
    });
    const capability = providerSurfaceCapability(view, "openai");
    expect(capability.rooms.ready).toBe(false);
    expect(capability.workspace).toEqual({ ready: true, via: ["cli"] });
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
      },
    });
    expect(workspaceReadyProviders(view)).toEqual(["anthropic", "openai"]);
  });

  it("is empty when the member has only browser subscriptions", () => {
    expect(
      workspaceReadyProviders(
        snapshot({ cliSubscriptions: [sub("codex"), sub("claude")] }),
      ),
    ).toEqual([]);
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
});
