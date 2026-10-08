import { z } from "zod";

import { apiError, getApiUser } from "@/lib/http/api";
import {
  loadProviderConnectionSnapshot,
  revokePersonalProviderConnection,
  savePersonalProviderConnection,
} from "@/lib/providers/provider-connection-server";
import { publicProviderConnectionPayload } from "@/lib/providers/provider-connection-view";

const providerSchema = z.enum(["openai", "anthropic", "cursor"]);
const putSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(20).max(512),
});

/**
 * The signed-in member's own provider connections, outside any workspace.
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
    const url = new URL(request.url);
    const provider = providerSchema.parse(url.searchParams.get("provider"));
    const kind = z
      .enum(["api_key", "claude_cli_token"])
      .parse(url.searchParams.get("kind") ?? "api_key");
    return Response.json(
      await revokePersonalProviderConnection(user, provider, kind),
    );
  } catch (error) {
    return apiError(error);
  }
}
