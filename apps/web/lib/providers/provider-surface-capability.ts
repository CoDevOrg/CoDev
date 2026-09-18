import type {
  CredentialProvenance,
  ProviderConnectionProvider,
  ProviderConnectionSnapshot,
} from "./provider-connection-view";

/**
 * Per-provider, per-surface readiness — the single source of truth the
 * workspace page, both settings sections, and the workspace-start preflight
 * read. Derived purely from the connection snapshot.
 *
 * The rule, uniform across providers:
 *  - A coding workspace runs on a shared host, so it may use a credential only
 *    when the member enabled it there. Codex browser OAuth is workspace-capable
 *    because it yields the same auth cache as `codex login`; other browser
 *    subscription runtimes remain rooms-only.
 *  - A chat room runs on the member's own credential, so it accepts a browser
 *    or local-CLI subscription the member enabled for rooms.
 *
 * `ROOMS_ACCEPT_API_KEY` is off: the rooms executor (shared-chat-reply)
 * currently runs only the two subscription forms. Flip it once the executor
 * can run an API key so the settings copy and this table stay truthful.
 */
const ROOMS_ACCEPT_API_KEY = false;

export type ProviderSurface = "rooms" | "workspace";

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

const SUBSCRIPTION_FOR: Record<
  ProviderConnectionProvider,
  "codex" | "claude" | "cursor"
> = { openai: "codex", anthropic: "claude", cursor: "cursor" };

function readiness(via: CredentialProvenance[]): SurfaceReadiness {
  return { ready: via.length > 0, via };
}

export function providerSurfaceCapability(
  snapshot: ProviderConnectionSnapshot,
  provider: ProviderConnectionProvider,
): ProviderSurfaceCapability {
  const apiKey = snapshot.connections.find((row) => row.provider === provider);
  const subscription = snapshot.cliSubscriptions.find(
    (row) => row.provider === SUBSCRIPTION_FOR[provider],
  );
  const keyConnected = apiKey?.status === "connected";
  const subConnected = subscription?.status === "connected";
  // Claude's CLI setup-token is a second, workspace-capable login kept in its
  // own slot; the browser runtime in `cliSubscriptions` is rooms-only.
  const claudeCli =
    provider === "anthropic" && snapshot.claudeCliToken.status === "connected"
      ? snapshot.claudeCliToken
      : null;

  const rooms: CredentialProvenance[] = [];
  if (subConnected && subscription.enabledForRooms && subscription.provenance) {
    rooms.push(subscription.provenance);
  }
  if (claudeCli?.enabledForRooms) rooms.push("cli");
  if (ROOMS_ACCEPT_API_KEY && keyConnected && apiKey.enabledForRooms) {
    rooms.push("api_key");
  }

  const personalWorkspace: CredentialProvenance[] = [];
  if (keyConnected && apiKey.enabledForWorkspace) {
    personalWorkspace.push("api_key");
  }
  if (
    subConnected &&
    subscription.enabledForWorkspace &&
    (subscription.provenance === "cli" || provider === "openai")
  ) {
    personalWorkspace.push(subscription.provenance ?? "cli");
  }
  if (claudeCli?.enabledForWorkspace) personalWorkspace.push("cli");

  // No personal login for this workspace's host — fall back to the
  // workspace's own shared (`--org`) login, if one is connected and shared.
  // `loadProviderConnectionSnapshot` only sets this when a workspace id was
  // given and the viewer reached this workspace (so membership already holds).
  // Cursor has no shared-login concept, so it is never a valid key here.
  const sharedWorkspace =
    (provider === "anthropic" || provider === "openai") &&
    Boolean(snapshot.sharedWorkspaceLogin?.[provider]);

  const workspace: SurfaceReadiness =
    personalWorkspace.length > 0
      ? { ...readiness([...new Set(personalWorkspace)]), source: "personal" }
      : sharedWorkspace
        ? { ready: true, via: ["cli"], source: "shared" }
        : readiness([]);

  return {
    rooms: readiness([...new Set(rooms)]),
    workspace,
  };
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
};

export function workspaceProviderReadiness(
  preflight: WorkspaceProviderPreflight,
): WorkspaceProviderReadiness {
  if (preflight.starting !== null) {
    return {
      ready: true,
      agent: preflight.starting,
      reason: null,
      settingsHref: WORKSPACE_PROVIDER_SETTINGS_HREF,
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
  };
}
