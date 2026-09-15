import "server-only";

import type { CredentialType } from "@codev/shared-types";

import {
  deleteProviderCredential,
  getClaudeCliTokenPublicStatus,
  getProviderCredentialStatus,
  saveAnthropicCredential,
  saveCursorCredential,
  saveOpenAICredential,
  updateCredentialSurfaces,
  type CredentialSurface,
  type CredentialSurfaces,
} from "./credentials";
import { isHostedClaudeConnectEnabled } from "./claude-connection-runner";
import { isHostedCodexSubscriptionEnabled } from "./hosted-codex-subscription-flag";
import {
  getConnectedClaudeRuntime,
  disconnectClaudeRuntime,
} from "./claude-connection-session";
import {
  disconnectHostedCodexSubscription,
  getHostedCodexPublicStatus,
} from "./hosted-codex-subscription-credentials";
import { getOAuthFlowMode } from "./oauth";
import {
  publicProviderConnectionPayload,
  toProviderConnectionSnapshot,
  type CliSubscriptionProvider,
  type ProviderConnectionProvider,
  type ProviderConnectionSnapshot,
} from "./provider-connection-view";
import { displayMemberName } from "./shared-session-view";

type ConnectionUser = {
  id: string;
  name?: string | null;
  githubLogin?: string;
};

export async function loadProviderConnectionSnapshot(
  user: ConnectionUser,
  /** When given, also reports whether *this* workspace has a connected,
   *  shared (`--org`) login per provider — `sharedWorkspaceLogin` on the
   *  result. The caller must already know the viewer belongs to this
   *  workspace (e.g. `getWorkspaceForMember` succeeded); this does not
   *  re-check membership. */
  workspaceId?: string,
): Promise<ProviderConnectionSnapshot> {
  const [
    openai,
    anthropic,
    cursorKey,
    hostedCodex,
    codexOAuth,
    claudeRuntime,
    claudeCliToken,
    cursorOAuth,
    sharedCodex,
    sharedClaude,
  ] = await Promise.all([
    getProviderCredentialStatus("USER", user.id, "openai", "API_KEY"),
    getProviderCredentialStatus("USER", user.id, "anthropic", "API_KEY"),
    getProviderCredentialStatus("USER", user.id, "cursor", "API_KEY"),
    getProviderCredentialStatus(
      "USER",
      user.id,
      "openai",
      "HOSTED_CODEX_SUBSCRIPTION",
    ),
    getProviderCredentialStatus("USER", user.id, "openai", "OAUTH_TOKEN"),
    getConnectedClaudeRuntime(user.id),
    // Only a CLI-stamped setup-token is reported; a browser-era token is not.
    getProviderCredentialStatus("USER", user.id, "anthropic", "OAUTH_TOKEN"),
    getProviderCredentialStatus("USER", user.id, "cursor", "OAUTH_TOKEN"),
    workspaceId
      ? getHostedCodexPublicStatus({
          scopeType: "ORGANIZATION",
          scopeId: workspaceId,
          canManage: false,
        })
      : null,
    workspaceId
      ? getClaudeCliTokenPublicStatus({
          scopeType: "ORGANIZATION",
          scopeId: workspaceId,
          canManage: false,
        })
      : null,
  ]);
  return toProviderConnectionSnapshot({
    viewer: {
      id: user.id,
      name: displayMemberName(user.name, user.githubLogin),
    },
    statuses: {
      openai,
      anthropic,
      cursor: cursorKey,
    },
    cliSubscriptionStatuses: {
      // Codex counts as signed in whether the login arrived through the CoDev
      // CLI or the in-page device-code flow. Both produce the refreshable auth
      // cache that the member-scoped workspace runtime consumes.
      codex: hostedCodex ?? codexOAuth,
      // The browser runtime keeps its credential outside provider_credentials
      // and can never reach a workspace host, so it is inherently rooms-only.
      claude: claudeRuntime
        ? {
            credentialType: "OAUTH_TOKEN",
            lastFour: "Official runtime",
            connectedVia: "browser",
            enabledForRooms: true,
            enabledForWorkspace: false,
          }
        : null,
      cursor: cursorOAuth,
    },
    claudeCliToken,
    connectModes: {
      codex: getOAuthFlowMode("codex"),
      claude: getOAuthFlowMode("claude"),
      cursor: "cursor_deeplink",
    },
    hostedClaudeConnect: isHostedClaudeConnectEnabled(),
    hostedOpenAIConnect: isHostedCodexSubscriptionEnabled(),
    ...(workspaceId
      ? {
          sharedWorkspaceLogin: {
            openai: Boolean(
              sharedCodex?.status === "connected" && sharedCodex.sharingEnabled,
            ),
            anthropic: Boolean(
              sharedClaude?.status === "connected" &&
              sharedClaude.sharingEnabled,
            ),
          },
        }
      : {}),
  });
}

/**
 * Save a pasted API key. `surface` is the settings section the member pasted
 * it in: a key connected there is enabled for that surface only, and the
 * member opts it into the other with a toggle. Omitted (legacy callers) means
 * both, matching how keys behaved before surfaces existed.
 */
export async function savePersonalProviderConnection(
  user: ConnectionUser,
  provider: ProviderConnectionProvider,
  apiKey: string,
  surface?: CredentialSurface,
): Promise<ProviderConnectionSnapshot> {
  const enabledFor: CredentialSurfaces | undefined = surface
    ? { rooms: surface === "rooms", workspace: surface === "workspace" }
    : undefined;
  if (provider === "openai") {
    await saveOpenAICredential(user.id, apiKey, enabledFor);
  } else if (provider === "cursor") {
    await saveCursorCredential(user.id, apiKey, enabledFor);
  } else {
    await saveAnthropicCredential(user.id, apiKey, enabledFor);
  }
  return publicProviderConnectionPayload(
    await loadProviderConnectionSnapshot(user),
    apiKey,
  );
}

/**
 * Revoke a pasted API key, or — `kind: "claude_cli_token"` — the Claude
 * setup-token uploaded with `codev claude-auth`, which lives in its own row.
 */
export async function revokePersonalProviderConnection(
  user: ConnectionUser,
  provider: ProviderConnectionProvider,
  kind: "api_key" | "claude_cli_token" = "api_key",
): Promise<ProviderConnectionSnapshot> {
  if (kind === "claude_cli_token") {
    if (provider !== "anthropic")
      throw new Error("Only Claude has a CLI token.");
    await deleteProviderCredential("USER", user.id, "anthropic", "OAUTH_TOKEN");
  } else {
    await deleteProviderCredential("USER", user.id, provider, "API_KEY");
  }
  return publicProviderConnectionPayload(
    await loadProviderConnectionSnapshot(user),
  );
}

/** The toggleable credential kinds on the settings page. The Claude browser
 *  runtime has no provider_credentials row and is rooms-only by construction,
 *  so it is deliberately not one of them. */
export type PersonalCredentialKind =
  | "api_key"
  | "subscription"
  | "claude_cli_token";

/** Map a settings-page surface toggle onto the concrete row it flips. */
export async function setPersonalCredentialSurface(
  user: ConnectionUser,
  input: {
    provider: ProviderConnectionProvider;
    kind: PersonalCredentialKind;
    surface: CredentialSurface;
    enabled: boolean;
  },
): Promise<ProviderConnectionSnapshot> {
  let credentialType: CredentialType;
  if (input.kind === "api_key") {
    credentialType = "API_KEY";
  } else if (input.kind === "claude_cli_token") {
    if (input.provider !== "anthropic") {
      throw new Error("Only Claude has a CLI token.");
    }
    credentialType = "OAUTH_TOKEN";
  } else if (input.provider === "openai") {
    credentialType = "HOSTED_CODEX_SUBSCRIPTION";
  } else if (input.provider === "cursor") {
    credentialType = "OAUTH_TOKEN";
  } else {
    throw new Error(
      "The Claude browser login is used by chat rooms only and cannot be changed here.",
    );
  }
  await updateCredentialSurfaces(
    "USER",
    user.id,
    input.provider,
    credentialType,
    {
      [input.surface]: input.enabled,
    },
  );
  return publicProviderConnectionPayload(
    await loadProviderConnectionSnapshot(user),
  );
}

/**
 * Sign the member out of an agent subscription. Codex has two possible
 * logins — the CLI's hosted auth cache and the in-page device flow — so both
 * are cleared rather than leaving a stale one behind that keeps the card
 * showing "Connected" after a disconnect.
 */
export async function revokePersonalSubscription(
  user: ConnectionUser,
  provider: CliSubscriptionProvider,
): Promise<ProviderConnectionSnapshot> {
  if (provider === "claude") {
    await disconnectClaudeRuntime(user.id);
    await deleteProviderCredential("USER", user.id, "anthropic", "OAUTH_TOKEN");
  } else if (provider === "cursor") {
    await deleteProviderCredential("USER", user.id, "cursor", "OAUTH_TOKEN");
  } else {
    await Promise.all([
      disconnectHostedCodexSubscription({
        userId: user.id,
        scopeType: "USER",
        scopeId: user.id,
      }),
      deleteProviderCredential("USER", user.id, "openai", "OAUTH_TOKEN"),
    ]);
  }
  return publicProviderConnectionPayload(
    await loadProviderConnectionSnapshot(user),
  );
}
