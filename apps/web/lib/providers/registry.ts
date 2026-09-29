import type { AuthProvider } from "@codev/shared-types";

/**
 * The provider registry: one place that says what a credential *is*, where it
 * can run, and what a machine needs on disk to use it.
 *
 * This exists because the same three questions used to be answered in four
 * places that drifted apart — `surfacePredicates` in `credentials.ts`, the
 * hand-written table in `provider-surface-capability.ts`, the ternaries in
 * `provider-account-card.tsx`, and the `enabledFor` defaults each connect
 * flow happened to pass. A member could be told an agent was ready on a
 * surface whose executor could not run it, which is exactly what happened to
 * the Claude setup-token in chat rooms.
 *
 * Adding a provider should be adding an entry here plus a loader in
 * `resolve.ts` — not a new resolver, a new readiness shape, and a new column.
 */

/** A coding agent a member connects. Not the same as the credential's
 *  `provider` column, which is the vendor (`openai`, `anthropic`, `cursor`). */
export type ProviderId = "codex" | "claude" | "cursor";

/**
 * The executors that can run a credential. `workspace` is the Gen 1 Orca IDE
 * host and `gen2` the Firecracker instance: they are separate because they
 * accept credentials differently. The Gen 1 host takes named per-provider
 * fields (`StartIdeInput.claudeCodeOauthToken` and five siblings); the Gen 2
 * guest exec route takes only `codexAuthCacheJson` and has no channel for an
 * environment variable at all. Collapsing the two would re-create the lie
 * this registry exists to prevent.
 */
export type ExecutorSurface = "rooms" | "workspace" | "gen2";

export const EXECUTOR_SURFACES: readonly ExecutorSurface[] = [
  "rooms",
  "workspace",
  "gen2",
];

/** How a member obtains a credential. */
export type ConnectMethod = "browser" | "cli" | "paste";

/**
 * The concrete credential shapes CoDev holds. This is finer than "API key vs
 * subscription" on purpose: Claude's two subscription logins are different
 * credentials that run in different places, and calling them one thing is
 * what produced the mismatch above.
 */
export type CredentialKind =
  | "codex_auth_cache"
  | "claude_setup_token"
  | "cursor_tokens"
  | "api_key";

/** What a launched process needs in order to authenticate as the member.
 *  The neutral replacement for passing `codexAuthCacheJson` by name. */
export type LaunchProfile = {
  /** Written into the process's private profile directory, mode 0600.
   *  Paths are relative to it and may not escape it. */
  files?: Array<{ path: string; contents: string }>;
  /** Injected into the process environment; never onto the command line,
   *  where another member's shell could read it out of `ps`. A value may
   *  contain `{{profileDir}}`, which the guest expands to the directory it
   *  created — how a caller names `CODEX_HOME` without knowing the path. */
  env?: Record<string, string>;
};

/** The guest substitutes this for the profile directory it created; see
 *  `LaunchProfile` in `services/orchestrator/src/model.rs`. */
export const PROFILE_DIR_TOKEN = "{{profileDir}}";

/** A resolved credential's secret material, discriminated by kind. */
export type ResolvedSecret =
  | { kind: "codex_auth_cache"; authCacheJson: string }
  | { kind: "claude_setup_token"; token: string }
  | { kind: "cursor_tokens"; accessToken: string; refreshToken: string }
  | { kind: "api_key"; apiKey: string };

export type ProviderCredentialKind = {
  kind: CredentialKind;
  label: string;
  connect: readonly ConnectMethod[];
  /** Which executors can actually run this credential today. */
  runs: Readonly<Record<ExecutorSurface, boolean>>;
};

export type ProviderDefinition = {
  id: ProviderId;
  label: string;
  /** The vendor this provider's credentials are stored under. */
  vendor: AuthProvider;
  /** Credential kinds in resolution preference order. */
  kinds: readonly ProviderCredentialKind[];
};

const CODEX: ProviderDefinition = {
  id: "codex",
  label: "Codex",
  vendor: "openai",
  kinds: [
    {
      kind: "codex_auth_cache",
      label: "ChatGPT subscription",
      // The browser device-code flow and `codev codex-auth` produce a
      // byte-identical `auth.json` (see `codex-oauth-connection.ts`), so
      // unlike every other browser sign-in this one does reach a shared host.
      connect: ["browser", "cli"],
      runs: { rooms: true, workspace: true, gen2: true },
    },
    {
      kind: "api_key",
      label: "OpenAI API key",
      connect: ["paste"],
      // Rooms run only the two subscription forms today; the rooms executor
      // has no API-key path (`resolvePersonalChatSubscription`).
      runs: { rooms: false, workspace: true, gen2: true },
    },
  ],
};

const CLAUDE: ProviderDefinition = {
  id: "claude",
  label: "Claude",
  vendor: "anthropic",
  kinds: [
    {
      kind: "claude_setup_token",
      label: "Claude subscription",
      // Both sign-ins now end at the same credential: the browser login
      // captures the token the CLI prints instead of leaving a signed-in
      // profile behind in a per-member Firecracker snapshot, so there is one
      // Claude login rather than two that ran in different places.
      connect: ["browser", "cli"],
      runs: { rooms: true, workspace: true, gen2: true },
    },
    {
      kind: "api_key",
      label: "Anthropic API key",
      connect: ["paste"],
      runs: { rooms: false, workspace: true, gen2: false },
    },
  ],
};

const CURSOR: ProviderDefinition = {
  id: "cursor",
  label: "Cursor",
  vendor: "cursor",
  kinds: [
    {
      kind: "cursor_tokens",
      label: "Cursor login",
      connect: ["browser", "paste"],
      runs: { rooms: false, workspace: true, gen2: false },
    },
    {
      kind: "api_key",
      label: "Cursor API key",
      connect: ["paste"],
      runs: { rooms: false, workspace: true, gen2: false },
    },
  ],
};

export const PROVIDERS: Readonly<Record<ProviderId, ProviderDefinition>> = {
  codex: CODEX,
  claude: CLAUDE,
  cursor: CURSOR,
};

export const PROVIDER_IDS: readonly ProviderId[] = [
  "codex",
  "claude",
  "cursor",
];

export function providerDefinition(id: ProviderId): ProviderDefinition {
  return PROVIDERS[id];
}

/** The vendor a provider's credentials are stored under. */
export function providerVendor(id: ProviderId): AuthProvider {
  return PROVIDERS[id].vendor;
}

/** The provider that owns a vendor's credentials, or null for a vendor no
 *  agent runs on (`bedrock`, `azure_foundry`). */
export function providerForVendor(vendor: string): ProviderId | null {
  return PROVIDER_IDS.find((id) => PROVIDERS[id].vendor === vendor) ?? null;
}

/** The kinds of this provider that the given executor can run, in
 *  preference order. */
export function runnableKinds(
  id: ProviderId,
  surface: ExecutorSurface,
): readonly ProviderCredentialKind[] {
  return PROVIDERS[id].kinds.filter((entry) => entry.runs[surface]);
}

/** Whether any of this provider's kinds can run on the given executor. A
 *  provider with none is not "not connected" — it is unsupported there, and
 *  the member should be told that instead of being sent to connect again. */
export function providerRunsOn(
  id: ProviderId,
  surface: ExecutorSurface,
): boolean {
  return runnableKinds(id, surface).length > 0;
}

/** The `auth.json` the Codex CLI writes for plain API-key auth. Codex reads a
 *  file, not `OPENAI_API_KEY`, so an API key reaches it the same way a
 *  subscription does. */
export function codexApiKeyAuthCache(apiKey: string): string {
  return JSON.stringify({
    auth_mode: "apikey",
    OPENAI_API_KEY: apiKey,
    tokens: null,
    last_refresh: new Date().toISOString(),
  });
}

const API_KEY_ENV: Readonly<Record<ProviderId, string>> = {
  codex: "OPENAI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  cursor: "CURSOR_API_KEY",
};

/**
 * What a launched agent process needs in order to authenticate as the member.
 *
 * One exhaustive switch, so a new credential kind cannot be added without
 * deciding how a machine consumes it. The provider is a parameter because the
 * same kind lands differently per vendor: Codex wants an `auth.json` even for
 * a bare key, while Claude and Cursor want an environment variable.
 */
export function launchProfileFor(
  id: ProviderId,
  secret: ResolvedSecret,
): LaunchProfile {
  switch (secret.kind) {
    case "codex_auth_cache":
      return {
        files: [{ path: ".codex/auth.json", contents: secret.authCacheJson }],
        env: { CODEX_HOME: `${PROFILE_DIR_TOKEN}/.codex` },
      };
    case "claude_setup_token":
      return { env: { CLAUDE_CODE_OAUTH_TOKEN: secret.token } };
    case "cursor_tokens":
      return {
        files: [
          {
            path: ".cursor/auth.json",
            contents: JSON.stringify({
              accessToken: secret.accessToken,
              refreshToken: secret.refreshToken,
            }),
          },
        ],
      };
    case "api_key":
      return id === "codex"
        ? {
            files: [
              {
                path: ".codex/auth.json",
                contents: codexApiKeyAuthCache(secret.apiKey),
              },
            ],
            env: { CODEX_HOME: `${PROFILE_DIR_TOKEN}/.codex` },
          }
        : { env: { [API_KEY_ENV[id]]: secret.apiKey } };
  }
}
