import { withUser } from "@/lib/http/api-route";
import { getGen2ProviderStatus } from "@/lib/gen2/providers";
import { listGen2ProviderReadiness } from "@/lib/gen2/provider-adapters";

/**
 * Redacted readiness for every known provider. The legacy OpenAI fields keep
 * the current single-provider composer working until provider choice ships.
 */
export const GET = withUser(
  async ({ user }) => {
    const [providers, openAi] = await Promise.all([
      listGen2ProviderReadiness(user.id),
      getGen2ProviderStatus(user.id),
    ]);
    return Response.json({ ...openAi, providers });
  },
  { errorStatus: 500 },
);
