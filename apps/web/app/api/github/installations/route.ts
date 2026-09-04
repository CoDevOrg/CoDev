import { apiError, getApiUserAnyAuth } from "@/lib/api";
import { listGitHubInstallations, resolveGithubConnection } from "@/lib/github";

export async function GET(request: Request) {
  const user = await getApiUserAnyAuth(request);
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    // GitHub answers `/user/installations` with every installation the member
    // can reach, which includes other people's personal accounts when they are
    // a collaborator there. The caller needs their own login to tell those
    // apart in the picker.
    const [installations, connection] = await Promise.all([
      listGitHubInstallations(user.id),
      resolveGithubConnection(user.id),
    ]);
    return Response.json({ installations, login: connection.login });
  } catch (error) {
    return apiError(error);
  }
}
