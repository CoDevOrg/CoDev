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
} from "./credentials";
import { isHostedClaudeConnectEnabled } from "./claude-connection-runner";
import { isHostedCodexSubscriptionEnabled } from "./hosted-codex-subscription-flag";
import { disconnectClaudeRuntime } from "./claude-connection-session";
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
import { displayMemberName } from "../chat/shared-session-view";

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
    // Only a CLI-stamped setup-token is reported; a browser-era token is not.
    getProviderCredentialStatus("USER", user.id, "anthropic", "OAUTH_TOKEN"),
    getProviderCredentialStatus("USER", user.id, "cursor", "OAUTH_TOKEN"),
    workspaceId
      ? getHostedCodexPublicStatus({
          scopeType: "WORKSPACE",
          scopeId: workspaceId,
          canManage: false,
        })
      : null,
    workspaceId
      ? getClaudeCliTokenPublicStatus({
          scopeType: "WORKSPACE",
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
      // One Claude login, whichever way it was made: the browser sign-in
      // captures the same setup-token the CLI upload sends, so both land in
      // the same row and this card and `claudeCliToken` describe one thing.
      claude: claudeCliToken,
      cursor: cursorOAuth,
    },
    claudeCliToken,
    connectModes: {
      codex: getOAuthFlowMode("codex"),
      // Claude has no CoDev-run OAuth flow: the in-app button drives the
      // official login runtime, and the fallback is `codev claude-auth`.
      claude: "manual_code",
      cursor: "cursor_deeplink",
    },
    hostedClaudeConnect: isHostedClaudeConnectEnabled(),
    hostedOpenAIConnect: isHostedCodexSubscriptionEnabled(),
    ...(workspaceId
      ? {
          sharedWorkspaceLogin: {
            // A workspace-scoped login belongs to that workspace's members;
            // there is no second sharing flag to consult any more.
            openai: sharedCodex?.status === "connected",
            anthropic: sharedClaude?.status === "connected",
          },
        }
      : {}),
  });
}

/**
 * Save a pasted API key.
 *
 * The settings section it was pasted in used to decide which surfaces the key
 * was enabled for. It no longer does: where an API key can run is the
 * registry's answer, and a key pasted in one section was never usable in the
 * other anyway. The request may still carry `surface`; it is ignored.
 */
export async function savePersonalProviderConnection(
  user: ConnectionUser,
  provider: ProviderConnectionProvider,
  apiKey: string,
): Promise<ProviderConnectionSnapshot> {
  if (provider === "openai") {
    await saveOpenAICredential(user.id, apiKey);
  } else if (provider === "cursor") {
    await saveCursorCredential(user.id, apiKey);
  } else {
    await saveAnthropicCredential(user.id, apiKey);
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

/**
 * Flip whether a credential may fund a turn inside a shared workspace — the
 * member's one remaining per-credential choice. `surface` is accepted for the
 * existing route shape; only the workspace setting is stored, because rooms
 * always run on the member's own credential in their own session.
 */
export async function setPersonalCredentialSurface(
  user: ConnectionUser,
  input: {
    provider: ProviderConnectionProvider;
    kind: PersonalCredentialKind;
    surface: CredentialSurface;
    enabled: boolean;
  },
): Promise<ProviderConnectionSnapshot> {
  if (input.surface === "rooms") {
    // Nothing to store: a room reply always runs on the sender's own login.
    return publicProviderConnectionPayload(
      await loadProviderConnectionSnapshot(user),
    );
  }
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
    input.enabled,
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
