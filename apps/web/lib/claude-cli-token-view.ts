export const CLAUDE_CLI_TOKEN_KIND = "claude_cli_token" as const;

export type ClaudeCliTokenScopeType = "USER" | "ORGANIZATION";

/** The `codev claude-auth` setup-token's public status — mirrors
 *  `HostedCodexPublicStatus` (`hosted-codex-subscription-view.ts`) so the two
 *  providers' org-sharing UI stay in the same shape. */
export type ClaudeCliTokenPublicStatus = {
  kind: typeof CLAUDE_CLI_TOKEN_KIND;
  scopeType: ClaudeCliTokenScopeType;
  status: "not_connected" | "connected";
  stateText: string;
  lastFour: string | null;
  /** Whether every member of the scope may use this login — see
   *  `scoped-credential-sharing.ts`. Always false for USER scope. */
  sharingEnabled: boolean;
  canManage: boolean;
};
