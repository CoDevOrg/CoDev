import { z } from "zod";

export const authProviderSchema = z.enum([
  "anthropic",
  "openai",
  "bedrock",
  "azure_foundry",
  "cursor",
  "custom",
]);
export const credentialTypeSchema = z.enum([
  "API_KEY",
  "OAUTH_TOKEN",
  "AWS_BEDROCK_ROLE",
  "AZURE_ENDPOINT",
  "HOSTED_CODEX_SUBSCRIPTION",
]);
export const credentialScopeTypeSchema = z.enum([
  "USER",
  "WORKSPACE",
  "ORGANIZATION",
]);
export const providerCredentialStatusSchema = z.enum([
  "active",
  "reauthorization_required",
  "revoked",
  "failed",
]);
export const hostedCodexScopeTypeSchema = z.enum(["USER", "ORGANIZATION"]);

export type AuthProvider = z.infer<typeof authProviderSchema>;
export type CredentialType = z.infer<typeof credentialTypeSchema>;
export type ScopeType = z.infer<typeof credentialScopeTypeSchema>;
export type ProviderCredentialStatus = z.infer<
  typeof providerCredentialStatusSchema
>;
export type HostedCodexScopeType = z.infer<typeof hostedCodexScopeTypeSchema>;

export const providerCredentialSchema = z.object({
  id: z.uuid(),
  scopeType: credentialScopeTypeSchema,
  scopeId: z.uuid(),
  provider: authProviderSchema,
  credentialType: credentialTypeSchema,
  priorityOrder: z.number().int().nonnegative(),
  encryptedApiKey: z.string().min(1).optional(),
  encryptedAccessToken: z.string().min(1).optional(),
  encryptedRefreshToken: z.string().min(1).optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
  endpointUrl: z.url().nullable().optional(),
  awsRoleArn: z.string().startsWith("arn:aws:iam::").nullable().optional(),
  isConnected: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type ProviderCredential = z.infer<typeof providerCredentialSchema>;
