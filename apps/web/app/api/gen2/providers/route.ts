import { withUser } from "@/lib/http/api-route";
import { getGen2ProviderStatus } from "@/lib/gen2/providers";

/**
 * Whether this member can run Codex yet. Returns only a boolean and how they
 * connected -- never any part of the credential.
 */
export const GET = withUser(
  async ({ user }) => Response.json(await getGen2ProviderStatus(user.id)),
  { errorStatus: 500 },
);
