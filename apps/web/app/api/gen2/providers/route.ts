import { withUser, errorResponse } from "@/lib/http/api-route";
import { discoverAccountModelsForWorker } from "@/lib/providers/model-catalog-service";
import { getGen2ProviderStatus } from "@/lib/gen2/providers";
import { gen2AgentProviderSchema } from "@codev/contracts";

/**
 * Whether this member can run the given agent (`?provider=`) yet. Returns only a boolean and how they connected --
 * never any part of the credential.
 */
export const GET = withUser(
  async ({ request, user }) => {
    const requested = new URL(request.url).searchParams.get("provider");
    if (!requested || requested === "all") {
      const [codex, claude, cursor] = await Promise.all([
        getGen2ProviderStatus(user.id, "codex"),
        getGen2ProviderStatus(user.id, "claude"),
        getGen2ProviderStatus(user.id, "cursor"),
      ]);
      return Response.json({
        codex,
        claude,
        cursor,
      });
    }

    const provider = gen2AgentProviderSchema.safeParse(requested);
    if (!provider.success) {
      return Response.json({ error: "Unknown provider." }, { status: 400 });
    }
    return Response.json(await getGen2ProviderStatus(user.id, provider.data));
  },
  { errorStatus: 500 },
);

/** Internal Cloudflare-to-Vercel account catalog service. */
export async function POST(request: Request) {
  try {
    return Response.json(await discoverAccountModelsForWorker(request));
  } catch (error) {
    return errorResponse(error, 503);
  }
}
