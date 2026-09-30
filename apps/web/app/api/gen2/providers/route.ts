import { withUser } from "@/lib/http/api-route";
import { getGen2ProviderStatus } from "@/lib/gen2/providers";
import { gen2AgentProviderSchema } from "@codev/contracts";

/**
 * Whether this member can run the given agent (`?provider=codex|claude`,
 * Codex when omitted) yet. Returns only a boolean and how they connected --
 * never any part of the credential.
 */
export const GET = withUser(
  async ({ request, user }) => {
    const requested = new URL(request.url).searchParams.get("provider");
    const provider = gen2AgentProviderSchema.safeParse(requested ?? "codex");
    if (!provider.success) {
      return Response.json({ error: "Unknown provider." }, { status: 400 });
    }
    return Response.json(await getGen2ProviderStatus(user.id, provider.data));
  },
  { errorStatus: 500 },
);
