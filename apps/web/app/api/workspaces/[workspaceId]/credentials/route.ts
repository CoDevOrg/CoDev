import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { requireOrganizationSettingsWrite } from "@/lib/settings-access";
import {
  deleteProviderCredential,
  getProviderCredentialStatus,
  saveProviderCredential,
} from "@/lib/credentials";

const requestSchema = z.object({
  provider: z.enum(["anthropic", "openai", "bedrock", "azure_foundry"]),
  credentialType: z.enum(["API_KEY", "AWS_BEDROCK_ROLE", "AZURE_ENDPOINT"]),
  apiKey: z.string().trim().min(20).max(512).optional(),
  awsRoleArn: z.string().trim().startsWith("arn:aws:iam::").max(512).optional(),
  endpointUrl: z.url().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    const provider = z
      .enum(["anthropic", "openai", "bedrock", "azure_foundry"])
      .parse(new URL(request.url).searchParams.get("provider"));
    return Response.json(
      await getProviderCredentialStatus("WORKSPACE", workspaceId, provider),
    );
  } catch (error) {
    return apiError(error);
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
    await requireOrganizationSettingsWrite(user.id, workspaceId);
    const input = requestSchema.parse(await request.json());
    if (
      (input.credentialType === "API_KEY" && !input.apiKey) ||
      (input.credentialType === "AWS_BEDROCK_ROLE" && !input.awsRoleArn) ||
      (input.credentialType === "AZURE_ENDPOINT" &&
        (!input.apiKey || !input.endpointUrl))
    ) {
      throw new Error("The workspace credential configuration is incomplete.");
    }
    await saveProviderCredential({
      scopeType: "WORKSPACE",
      scopeId: workspaceId,
      provider: input.provider,
      credentialType: input.credentialType,
      apiKey: input.apiKey?.trim(),
      awsRoleArn: input.awsRoleArn,
      endpointUrl: input.endpointUrl,
      lastFour: input.apiKey?.trim().slice(-4),
    });
    return Response.json({ saved: true, provider: input.provider });
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
    await requireOrganizationSettingsWrite(user.id, workspaceId);
    const provider = z
      .enum(["anthropic", "openai", "bedrock", "azure_foundry"])
      .parse(new URL(request.url).searchParams.get("provider"));
    await deleteProviderCredential("WORKSPACE", workspaceId, provider);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
