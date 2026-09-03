import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { revokePersonalSubscription } from "@/lib/provider-connection-server";

const providerSchema = z.enum(["claude", "codex", "cursor"]);

/**
 * Sign the member out of an agent subscription (Claude Code, Codex, Cursor).
 * Connecting happens through each provider's own OAuth route; this is the one
 * shared way back out, so the settings card always has a Disconnect that
 * matches the Connect next to it.
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
