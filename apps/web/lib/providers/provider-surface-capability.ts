import {
  providerDefinition,
  type CredentialKind,
  type ExecutorSurface,
  type ProviderId,
} from "./registry";
import type {
  CredentialProvenance,
  ProviderConnectionProvider,
  ProviderConnectionSnapshot,
} from "./provider-connection-view";

/**
 * Per-provider, per-surface readiness for the settings and workspace UIs.
 *
 * This used to be a hand-written table of per-provider exceptions, kept in
 * step with the resolvers by hand and losing that race — a Claude
 * setup-token was reported ready for chat rooms that could not run it. It is
 * now a projection of the provider registry: which kinds the member has
 * connected, intersected with the kinds each executor can run. The server
 * resolves turns by walking the same table (`resolve.ts`), so the badge and
 * the executor cannot disagree.
 */

export type ProviderSurface = "rooms" | "workspace";

/** Which registry credential kind each connected slot in the snapshot is. */
const SUBSCRIPTION_KIND: Record<ProviderId, CredentialKind> = {
  codex: "codex_auth_cache",
  claude: "claude_runtime",
  cursor: "cursor_tokens",
};

const PROVIDER_FOR_VENDOR: Record<ProviderConnectionProvider, ProviderId> = {
  openai: "codex",
  anthropic: "claude",
  cursor: "cursor",
};

const VENDOR_SUBSCRIPTION: Record<
  ProviderConnectionProvider,
  "codex" | "claude" | "cursor"
> = { openai: "codex", anthropic: "claude", cursor: "cursor" };

export type SurfaceReadiness = {
  ready: boolean;
  /** The connected methods that make this surface ready, for the UI. */
  via: CredentialProvenance[];
  /** Whose login this is when `ready` — "shared" means the workspace's own
   *  `--org` login (see `scoped-credential-sharing.ts`), not the viewer's own.
   *  Only meaningful for `workspace`; rooms are always the viewer's login. */
  source?: "personal" | "shared";
};

export type ProviderSurfaceCapability = Record<
  ProviderSurface,
  SurfaceReadiness
>;

/** How each credential kind is described to a member. */
const KIND_PROVENANCE: Record<CredentialKind, CredentialProvenance> = {
  codex_auth_cache: "cli",
  claude_setup_token: "cli",
  claude_runtime: "browser",
  cursor_tokens: "browser",
  api_key: "api_key",
};

/** The credential kinds this member has connected for a provider, read off
 *  the snapshot the settings page already loads. */
function connectedKinds(
  snapshot: ProviderConnectionSnapshot,
  vendor: ProviderConnectionProvider,
): Map<CredentialKind, CredentialProvenance> {
  const provider = PROVIDER_FOR_VENDOR[vendor];
  const connected = new Map<CredentialKind, CredentialProvenance>();

  const subscription = snapshot.cliSubscriptions.find(
    (row) => row.provider === VENDOR_SUBSCRIPTION[vendor],
  );
  if (subscription?.status === "connected") {
    connected.set(
      SUBSCRIPTION_KIND[provider],
      subscription.provenance ?? KIND_PROVENANCE[SUBSCRIPTION_KIND[provider]],
    );
  }
  if (provider === "claude" && snapshot.claudeCliToken.status === "connected") {
    connected.set("claude_setup_token", "cli");
  }
  const apiKey = snapshot.connections.find((row) => row.provider === vendor);
  if (apiKey?.status === "connected") connected.set("api_key", "api_key");

  return connected;
}

function readinessFor(
  connected: Map<CredentialKind, CredentialProvenance>,
  provider: ProviderId,
  surface: ExecutorSurface,
): SurfaceReadiness {
  const via = providerDefinition(provider)
    .kinds.filter((entry) => entry.runs[surface] && connected.has(entry.kind))
    .map((entry) => connected.get(entry.kind)!);
  return { ready: via.length > 0, via: [...new Set(via)] };
}

export function providerSurfaceCapability(
  snapshot: ProviderConnectionSnapshot,
  vendor: ProviderConnectionProvider,
): ProviderSurfaceCapability {
  const provider = PROVIDER_FOR_VENDOR[vendor];
  const connected = connectedKinds(snapshot, vendor);
  const rooms = readinessFor(connected, provider, "rooms");
  const personalWorkspace = readinessFor(connected, provider, "workspace");

  // No personal login for this workspace's host — fall back to the
  // workspace's own shared (`--org`) login, if one is connected and shared.
  // `loadProviderConnectionSnapshot` only sets this when a workspace id was
  // given and the viewer reached this workspace (so membership already holds).
  // Cursor has no shared-login concept, so it is never a valid key here.
  const sharedWorkspace =
    (vendor === "anthropic" || vendor === "openai") &&
    Boolean(snapshot.sharedWorkspaceLogin?.[vendor]);

  const workspace: SurfaceReadiness = personalWorkspace.ready
    ? { ...personalWorkspace, source: "personal" }
    : sharedWorkspace
      ? { ready: true, via: ["cli"], source: "shared" }
      : personalWorkspace;

  return { rooms, workspace };
}

/** Providers the coding workspace can actually run, in preference order. */
export function workspaceReadyProviders(
  snapshot: ProviderConnectionSnapshot,
): ProviderConnectionProvider[] {
  return (["anthropic", "openai", "cursor"] as const).filter(
    (provider) => providerSurfaceCapability(snapshot, provider).workspace.ready,
  );
}

export type WorkspaceAgent = "claude" | "codex";

/** How each agent is named in member-facing copy. */
export const AGENT_LABEL: Record<WorkspaceAgent, string> = {
  claude: "Claude",
  codex: "Codex",
};

const AGENT_FOR: Record<"anthropic" | "openai", WorkspaceAgent> = {
  anthropic: "claude",
  openai: "codex",
};

/**
 * What a member is told as a coding workspace starts: the agent its default
 * chat tab will open with, and any agent they have connected *somewhere* that
 * cannot run in a workspace yet (typically a browser subscription), so the
 * fix — an API key or `codev <agent>-auth` — is named up front instead of the
 * agent booting to "Not logged in".
 */
export type WorkspaceProviderPreflight = {
  /** The agent the default chat tab opens with; null when nothing can run. */
  starting: WorkspaceAgent | null;
  /** Whose login `starting` will run on — see `SurfaceReadiness.source`. */
  startingSource?: "personal" | "shared" | undefined;
  /** Agents connected for chat rooms (or not at all) but not for workspaces. */
  notReady: Array<{ agent: WorkspaceAgent; connectedForRooms: boolean }>;
};

export function workspaceProviderPreflight(
  snapshot: ProviderConnectionSnapshot,
): WorkspaceProviderPreflight {
  const ready = workspaceReadyProviders(snapshot);
  const first = ready.find(
    (provider): provider is "anthropic" | "openai" => provider !== "cursor",
  );
  const notReady = (["anthropic", "openai"] as const)
    .filter((provider) => !ready.includes(provider))
    .map((provider) => ({
      agent: AGENT_FOR[provider],
      connectedForRooms: providerSurfaceCapability(snapshot, provider).rooms
        .ready,
    }));
  return {
    starting: first ? AGENT_FOR[first] : null,
    startingSource: first
      ? providerSurfaceCapability(snapshot, first).workspace.source
      : undefined,
    notReady,
  };
}

/** Where a member fixes a workspace provider gap. Shared by the startup
 *  banner and the readiness report sent into the embedded IDE, so the two
 *  never point at different places. */
export const WORKSPACE_PROVIDER_SETTINGS_HREF =
  "/settings/personal/providers#coding-workspaces";

/** What an agent connected for rooms but not workspaces needs. */
export function workspaceProviderFix(agent: WorkspaceAgent): string {
  return `add an API key or run codev ${agent}-auth`;
}

/**
 * Whether an agent can actually run in this workspace, in the shape the
 * embedded IDE consumes.
 *
 * The parent page has always known this — it renders it in the startup banner
 * — but never told the IDE, so the IDE opened a chat tab and accepted messages
 * for an agent that could not reply. This is that answer, on the wire.
 */
export type WorkspaceProviderReadiness = {
  ready: boolean;
  agent: WorkspaceAgent | null;
  reason: string | null;
  settingsHref: string;
  /** Provider-specific availability for the workspace agent picker. */
  providers: {
    claude: boolean;
    codex: boolean;
  };
};

export function workspaceProviderReadiness(
  preflight: WorkspaceProviderPreflight,
): WorkspaceProviderReadiness {
  const unavailable = new Set(preflight.notReady.map((entry) => entry.agent));
  if (preflight.starting !== null) {
    return {
      ready: true,
      agent: preflight.starting,
      reason: null,
      settingsHref: WORKSPACE_PROVIDER_SETTINGS_HREF,
      providers: {
        claude: !unavailable.has("claude"),
        codex: !unavailable.has("codex"),
      },
    };
  }
  // Naming the rooms-only case specifically matters: the member *has*
  // connected this agent and would otherwise read "not set up" as a bug.
  const roomsOnly = preflight.notReady.filter(
    (entry) => entry.connectedForRooms,
  );
  const reason =
    roomsOnly.length > 0
      ? `${roomsOnly.map((entry) => AGENT_LABEL[entry.agent]).join(" and ")} ${
          roomsOnly.length > 1 ? "are" : "is"
        } connected for chat rooms only — ${workspaceProviderFix(roomsOnly[0]!.agent)} to use ${
          roomsOnly.length > 1 ? "them" : "it"
        } in a coding workspace.`
      : "No coding agent is set up for this workspace yet.";
  return {
    ready: false,
    agent: null,
    reason,
    settingsHref: WORKSPACE_PROVIDER_SETTINGS_HREF,
    providers: {
      claude: !unavailable.has("claude"),
      codex: !unavailable.has("codex"),
    },
  };
}
