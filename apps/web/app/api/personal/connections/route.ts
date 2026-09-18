import { z } from "zod";

import { apiError, getApiUser } from "@/lib/http/api";
import {
  loadProviderConnectionSnapshot,
  revokePersonalProviderConnection,
  savePersonalProviderConnection,
  setPersonalCredentialSurface,
} from "@/lib/providers/provider-connection-server";
import { publicProviderConnectionPayload } from "@/lib/providers/provider-connection-view";

const providerSchema = z.enum(["openai", "anthropic", "cursor"]);
const surfaceSchema = z.enum(["rooms", "workspace"]);

const putSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(20).max(512),
  /** The settings section the key was pasted in; enables it there only. */
  surface: surfaceSchema.optional(),
});

const patchSchema = z.object({
  provider: providerSchema,
  kind: z.enum(["api_key", "subscription", "claude_cli_token"]),
  surface: surfaceSchema,
  enabled: z.boolean(),
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
      await savePersonalProviderConnection(
        user,
        input.provider,
        input.apiKey,
        input.surface,
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}

/** Flip a credential's "also use in <surface>" toggle. */
export async function PATCH(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const input = patchSchema.parse(await request.json());
    return Response.json(await setPersonalCredentialSurface(user, input));
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
