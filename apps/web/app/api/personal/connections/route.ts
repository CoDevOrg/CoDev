import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import {
  loadProviderConnectionSnapshot,
  revokePersonalProviderConnection,
  savePersonalProviderConnection,
} from "@/lib/provider-connection-server";
import { publicProviderConnectionPayload } from "@/lib/provider-connection-view";

const providerSchema = z.enum(["openai", "anthropic"]);

const putSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(20).max(512),
});

/**
 * The signed-in member's own provider connections, outside any workspace.
 * These are the same personal credential rows the workspace-scoped route
 * reads; only the workspace-membership check differs, because personal
 * settings are reachable without opening a workspace.
 */
export async function GET() {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    return Response.json(
      publicProviderConnectionPayload(
        await loadProviderConnectionSnapshot(user),
      ),
    );
  } catch (error) {
    return apiError(error, 502);
  }
}

export async function PUT(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const input = putSchema.parse(await request.json());
    return Response.json(
      await savePersonalProviderConnection(user, input.provider, input.apiKey),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const provider = providerSchema.parse(
      new URL(request.url).searchParams.get("provider"),
    );
    return Response.json(
      await revokePersonalProviderConnection(user, provider),
    );
  } catch (error) {
    return apiError(error);
  }
}
