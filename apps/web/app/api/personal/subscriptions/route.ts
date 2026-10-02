import { z } from "zod";

import { apiError, getApiUser } from "@/lib/http/api";
import { revokePersonalSubscription } from "@/lib/providers/provider-connection-server";

const providerSchema = z.enum(["claude", "codex", "cursor"]);

/**
 * Sign the member out of a Claude Code, Codex, or Cursor CLI login.
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
