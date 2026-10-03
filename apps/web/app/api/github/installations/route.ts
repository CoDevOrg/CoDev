import { apiError, getApiUserAnyAuth } from "@/lib/http/api";
import { GitHubApiError } from "@/lib/github/github";
import { listPickerAccounts } from "@/lib/github/repository-picker";

export async function GET(request: Request) {
  const user = await getApiUserAnyAuth(request);
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    return Response.json({ installations: await listPickerAccounts(user.id) });
  } catch (error) {
    return apiError(
      error,
      error instanceof GitHubApiError ? error.status : 400,
    );
  }
}
