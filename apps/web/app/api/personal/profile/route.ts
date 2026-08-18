import { apiError, getApiUser } from "@/lib/api";
import { isGitHubAuthConfigured } from "@codev/config";
import { getConnectedAccounts } from "@/lib/identity";

/**
 * The signed-in member's own profile identity and connected-account status,
 * outside any workspace. Read-only: display name, email, and security are
 * managed by the sign-in provider, and GitHub linking happens through a
 * top-level navigation, not this bridge.
 */
export async function GET() {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const connectedAccounts = await getConnectedAccounts(user.id);
    return Response.json({
      name: user.name ?? null,
      email: user.email ?? null,
      google: connectedAccounts.google,
      github: connectedAccounts.github,
      githubConnectUrl:
        !connectedAccounts.github.connected && isGitHubAuthConfigured()
          ? "/api/personal/profile/connect-github"
          : null,
    });
  } catch (error) {
    return apiError(error, 502);
  }
}
