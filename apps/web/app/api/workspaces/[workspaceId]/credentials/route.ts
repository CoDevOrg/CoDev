import { z } from "zod";

import { withUser, withWorkspace } from "@/lib/api-route";
import { requireOrganizationSettingsWrite } from "@/lib/settings-access";
import {
  deleteProviderCredential,
  getProviderCredentialStatus,
  saveProviderCredential,
} from "@/lib/credentials";

const requestSchema = z.object({
  provider: z.enum([
    "anthropic",
    "openai",
    "bedrock",
    "azure_foundry",
    "cursor",
  ]),
  credentialType: z.enum(["API_KEY", "AWS_BEDROCK_ROLE", "AZURE_ENDPOINT"]),
  apiKey: z.string().trim().min(20).max(512).optional(),
  awsRoleArn: z.string().trim().startsWith("arn:aws:iam::").max(512).optional(),
  endpointUrl: z.url().optional(),
});

const providerParam = z.enum([
  "anthropic",
  "openai",
  "bedrock",
  "azure_foundry",
  "cursor",
]);

type Params = { workspaceId: string };

export const GET = withWorkspace("view", async ({ request, workspaceId }) => {
  const provider = providerParam.parse(
    new URL(request.url).searchParams.get("provider"),
  );
  return Response.json(
    await getProviderCredentialStatus("WORKSPACE", workspaceId, provider),
  );
});

// Writing workspace credentials is an organization-settings right, not a
// workspace permission.
export const PUT = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
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
  },
);

export const DELETE = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    await requireOrganizationSettingsWrite(user.id, workspaceId);
    const provider = providerParam.parse(
      new URL(request.url).searchParams.get("provider"),
    );
    await deleteProviderCredential("WORKSPACE", workspaceId, provider);
    return new Response(null, { status: 204 });
  },
);
