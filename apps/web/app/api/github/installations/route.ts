import { apiError, getApiUserAnyAuth } from "@/lib/api";
import { listGitHubInstallations } from "@/lib/github";

export async function GET(request: Request) {
  const user = await getApiUserAnyAuth(request);
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    return Response.json({
      installations: await listGitHubInstallations(user.id),
    });
  } catch (error) {
    return apiError(error);
  }
}
