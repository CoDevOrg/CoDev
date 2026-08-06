import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import {
  deleteProviderCredential,
  getProviderCredentialStatus,
  saveProviderCredential,
} from "@/lib/credentials";

const requestSchema = z
  .object({
    provider: z.enum([
      "anthropic",
      "openai",
      "bedrock",
      "azure_foundry",
      "cursor",
    ]),
    credentialType: z.enum(["API_KEY", "AWS_BEDROCK_ROLE", "AZURE_ENDPOINT"]),
    apiKey: z.string().trim().min(20).max(512).optional(),
    awsRoleArn: z
      .string()
      .trim()
      .startsWith("arn:aws:iam::")
      .max(512)
      .optional(),
    endpointUrl: z.url().optional(),
  })
  .superRefine((input, context) => {
    if (input.credentialType === "API_KEY" && !input.apiKey) {
      context.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "An API key is required.",
      });
    }
    if (input.credentialType === "AWS_BEDROCK_ROLE" && !input.awsRoleArn) {
      context.addIssue({
        code: "custom",
        path: ["awsRoleArn"],
        message: "An AWS role ARN is required.",
      });
    }
    if (
      input.credentialType === "AZURE_ENDPOINT" &&
      (!input.apiKey || !input.endpointUrl)
    ) {
      context.addIssue({
        code: "custom",
        path: ["endpointUrl"],
        message: "An Azure endpoint and API key are required.",
      });
    }
  });

export async function PUT(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const input = requestSchema.parse(await request.json());
    await saveProviderCredential({
      scopeType: "USER",
      scopeId: user.id,
      provider: input.provider,
      credentialType: input.credentialType,
      apiKey: input.apiKey?.trim(),
      endpointUrl: input.endpointUrl,
      awsRoleArn: input.awsRoleArn,
      lastFour: input.apiKey?.trim().slice(-4),
    });
    return Response.json({ saved: true, provider: input.provider });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const provider = z
      .enum(["anthropic", "openai", "bedrock", "azure_foundry", "cursor"])
      .parse(new URL(request.url).searchParams.get("provider"));
    await deleteProviderCredential("USER", user.id, provider);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const provider = z
      .enum(["anthropic", "openai", "bedrock", "azure_foundry", "cursor"])
      .parse(new URL(request.url).searchParams.get("provider"));
    return Response.json(
      await getProviderCredentialStatus("USER", user.id, provider),
    );
  } catch (error) {
    return apiError(error);
  }
}
