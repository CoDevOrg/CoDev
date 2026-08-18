export type OAuthProvider = "claude" | "codex";
export type OAuthStatus = "connected" | "denied" | "error" | "not_configured";

export type OAuthNotice = {
  provider: OAuthProvider;
  status: OAuthStatus;
};

export function parseOAuthNotice(params: {
  oauth?: string;
  status?: string;
}): OAuthNotice | undefined {
  if (
    (params.oauth !== "claude" && params.oauth !== "codex") ||
    !["connected", "denied", "error", "not_configured"].includes(
      params.status ?? "",
    )
  ) {
    return undefined;
  }

  return {
    provider: params.oauth,
    status: params.status as OAuthStatus,
  };
}

export type HostedCodexNotice = { status: string; text: string };

export function parseHostedCodexNotice(params: {
  hostedCodex?: string;
}): HostedCodexNotice | undefined {
  switch (params.hostedCodex) {
    case "connected":
      return {
        status: "connected",
        text: "Codex subscription is connected. CoDev stores only encrypted server-side material.",
      };
    case "denied":
      return {
        status: "denied",
        text: "Codex connection was cancelled. You can try again whenever you are ready.",
      };
    case "unavailable":
      return {
        status: "unavailable",
        text: "Hosted Codex subscription connection is not enabled yet.",
      };
    case "error":
      return {
        status: "error",
        text: "Codex sign-in did not complete. Start Connect again from this page.",
      };
    default:
      return undefined;
  }
}
