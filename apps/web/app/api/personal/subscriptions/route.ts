import { z } from "zod";

import { apiError, getApiUser } from "@/lib/http/api";
import { revokePersonalSubscription } from "@/lib/providers/provider-connection-server";

const providerSchema = z.enum(["claude", "codex"]);

/**
 * Sign the member out of a Claude Code or Codex subscription.
 * The settings card uses this shared route to disconnect either provider.
 */
export async function DELETE(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const provider = providerSchema.parse(
      new URL(request.url).searchParams.get("provider"),
    );
    return Response.json(await revokePersonalSubscription(user, provider));
  } catch (error) {
    return apiError(error);
  }
}
