import { withUser } from "@/lib/http/api-route";
import { getGen2ProviderStatus } from "@/lib/gen2/providers";
import { getProviderCredentialStatus } from "@/lib/providers/credentials";
import { gen2AgentProviderSchema } from "@codev/contracts";

/**
 * Whether this member can run the given agent (`?provider=`) yet. Returns only a boolean and how they connected --
 * never any part of the credential.
 */
export const GET = withUser(
  async ({ request, user }) => {
    const requested = new URL(request.url).searchParams.get("provider");
    if (!requested || requested === "all") {
      const [codex, claude, cursorStatus] = await Promise.all([
        getGen2ProviderStatus(user.id, "codex"),
        getGen2ProviderStatus(user.id, "claude"),
        getProviderCredentialStatus(user.id, "cursor").catch(() => null),
      ]);
      return Response.json({
        codex,
        claude,
        cursor: cursorConnection(cursorStatus),
      });
    }

    if (requested === "cursor") {
      const cursorStatus = await getProviderCredentialStatus(
        user.id,
        "cursor",
      ).catch(() => null);
      return Response.json(cursorConnection(cursorStatus));
    }

    const provider = gen2AgentProviderSchema.safeParse(requested);
    if (!provider.success) {
      return Response.json({ error: "Unknown provider." }, { status: 400 });
    }
    return Response.json(await getGen2ProviderStatus(user.id, provider.data));
  },
  { errorStatus: 500 },
);

function cursorConnection(
  status: Awaited<ReturnType<typeof getProviderCredentialStatus>>,
) {
  if (!status) return { connected: false, via: null };
  return {
    connected: true,
    via:
      status.connectedVia === "cli" ? ("cli" as const) : ("api-key" as const),
  };
}
