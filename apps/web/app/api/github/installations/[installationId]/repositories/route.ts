import { apiError, getApiUser } from "@/lib/api";
import { listPublicRepositories } from "@/lib/github";

export async function GET(
  _request: Request,
  context: { params: Promise<{ installationId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const { installationId } = await context.params;
    const parsedInstallationId = Number(installationId);
    if (!Number.isSafeInteger(parsedInstallationId)) {
      throw new Error("Invalid GitHub installation.");
    }

    return Response.json({
      repositories: await listPublicRepositories(user.id, parsedInstallationId),
    });
  } catch (error) {
    return apiError(error);
  }
}
