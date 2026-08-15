import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import {
  completeFixtureOpenAiOAuth,
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

const oauthSchema = z.object({
  provider: z.literal("openai"),
  oauth: z.literal("fixture"),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    return Response.json(
      publicProviderConnectionPayload(
        await loadProviderConnectionSnapshot(user),
      ),
    );
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 502,
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    const input = putSchema.parse(await request.json());
    return Response.json(
      await savePersonalProviderConnection(user, input.provider, input.apiKey),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    oauthSchema.parse(await request.json());
    return Response.json(await completeFixtureOpenAiOAuth(user));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
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
