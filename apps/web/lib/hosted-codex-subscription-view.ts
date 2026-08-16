import type { HostedCodexScopeType } from "@codev/shared-types";

export const HOSTED_CODEX_KIND = "hosted_codex_subscription" as const;

export type HostedCodexPublicStatus = {
  kind: typeof HOSTED_CODEX_KIND;
  scopeType: HostedCodexScopeType;
  status:
    | "not_connected"
    | "connected"
    | "reauthorization_required"
    | "unavailable";
  stateText: string;
  accountLabel: string | null;
  sharingEnabled: boolean;
  canManage: boolean;
  enabled: boolean;
};
