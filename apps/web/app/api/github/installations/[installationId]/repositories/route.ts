import { apiError, getApiUserAnyAuth } from "@/lib/http/api";
import { GitHubApiError } from "@/lib/github/github";

import { listPickerRepositories } from "@/lib/github/repository-picker";

export async function GET(
  request: Request,
  context: { params: Promise<{ installationId: string }> },
) {
  const user = await getApiUserAnyAuth(request);
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const { installationId } = await context.params;
    const parsedInstallationId = Number(installationId);
    if (!Number.isSafeInteger(parsedInstallationId)) {
      throw new Error("Invalid GitHub installation.");
    }

    return Response.json({
      repositories: await listPickerRepositories(user.id, parsedInstallationId),
    });
  } catch (error) {
    return apiError(
      error,
      error instanceof GitHubApiError ? error.status : 400,
    );
  }
}
