import { apiError, getApiUser } from "@/lib/api";
import { getLaunchPreflight } from "@/lib/launch-preflight";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    return Response.json(await getLaunchPreflight(user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error, 503);
  }
}
