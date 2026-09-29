export const CLAUDE_CLI_TOKEN_KIND = "claude_cli_token" as const;

export type ClaudeCliTokenScopeType = "USER" | "WORKSPACE";

/** The `codev claude-auth` setup-token's public status — mirrors
 *  `HostedCodexPublicStatus` (`hosted-codex-subscription-view.ts`) so the two
 *  providers' org-sharing UI stay in the same shape. */
export type ClaudeCliTokenPublicStatus = {
  kind: typeof CLAUDE_CLI_TOKEN_KIND;
  scopeType: ClaudeCliTokenScopeType;
  status: "not_connected" | "connected";
  stateText: string;
  lastFour: string | null;
  canManage: boolean;
};
