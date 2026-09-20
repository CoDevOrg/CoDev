import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
);

export const serverEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: optionalUrl,
  POSTGRES_URL: optionalUrl,
  POSTGRES_URL_NON_POOLING: optionalUrl,
  SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  OPENFGA_API_URL: optionalUrl,
  OPENFGA_STORE_ID: z.string().min(1).optional(),
  OPENFGA_AUTHORIZATION_MODEL_ID: z.string().min(1).optional(),
  OPENFGA_CLIENT_TOKEN: z.string().min(1).optional(),
  OPENFGA_API_TOKEN_ISSUER: optionalUrl,
  OPENFGA_API_AUDIENCE: optionalUrl,
  OPENFGA_CLIENT_ID: z.string().min(1).optional(),
  OPENFGA_CLIENT_SECRET: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(32).optional(),
  AUTH_GITHUB_ID: z.string().min(1).optional(),
  AUTH_GITHUB_SECRET: z.string().min(1).optional(),
  AUTH_GOOGLE_ID: z.string().min(1).optional(),
  AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  AUTH_EMAIL_FROM: z.string().min(3).optional(),
  ACCESS_REQUEST_NOTIFY_EMAIL: z.string().min(3).optional(),
  // Comma-separated addresses that may create an account without a waitlist
  // invitation (the founding team). Everyone else needs an invite link.
  SIGNUP_ALLOWLIST: z.string().optional(),
  GITHUB_APP_SLUG: z.string().min(1).optional(),
  FEEDBACK_GITHUB_TOKEN: z.string().min(1).optional(),
  FEEDBACK_GITHUB_REPO: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/)
    .optional(),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(1).optional(),
  /** Key Vault key identifier that wraps every stored provider credential. */
  CREDENTIAL_KEY_VAULT_KEY_ID: z.string().url().optional(),
  PLATFORM_FALLBACK_API_KEY: z.string().min(1).optional(),
  PLATFORM_FALLBACK_BEDROCK_ROLE_ARN: z
    .string()
    .startsWith("arn:aws:iam::")
    .optional(),
  CODEV_PLATFORM_OPENAI_API_KEY: z.string().min(1).optional(),
  CODEV_PLATFORM_ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CODEV_PLATFORM_AZURE_FOUNDRY_API_KEY: z.string().min(1).optional(),
  CODEV_PLATFORM_AZURE_FOUNDRY_ENDPOINT: optionalUrl,
  CODEV_AGENT_PROVIDER: z
    .enum(["openai", "anthropic", "bedrock", "azure_foundry"])
    .optional(),
  CODEV_ANTHROPIC_MODEL: z.string().min(1).optional(),
  CODEV_BEDROCK_MODEL: z.string().min(1).optional(),
  CODEV_AZURE_FOUNDRY_MODEL: z.string().min(1).optional(),
  CLAUDE_OAUTH_SCOPE: z.string().min(1).optional(),
  CLAUDE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  CLAUDE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  CLAUDE_OAUTH_AUTHORIZE_URL: optionalUrl,
  CLAUDE_OAUTH_TOKEN_URL: optionalUrl,
  CLAUDE_OAUTH_REDIRECT_URI: optionalUrl,
  CODEX_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  CODEX_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  CODEX_OAUTH_AUTHORIZE_URL: optionalUrl,
  CODEX_OAUTH_TOKEN_URL: optionalUrl,
  CODEX_OAUTH_REDIRECT_URI: optionalUrl,
  CODEX_OAUTH_SCOPE: z.string().min(1).optional(),
  HOSTED_CODEX_EMERGENCY_DISABLED: z.enum(["true", "false"]).optional(),
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  REDIS_URL: optionalUrl,
  /**
   * Region for Amazon Bedrock, which members can bring as a model provider
   * (see ai-model.ts and the `bedrock` provider in packages/db). This is the
   * one remaining AWS variable, and it has nothing to do with the retired
   * EC2 runtime -- it serves somebody else's Bedrock account, not ours.
   */
  AWS_REGION: z.string().min(1).optional(),
  AZURE_TENANT_ID: z.string().uuid().optional(),
  /**
   * Application (client) id of the Entra app registration apps/web federates
   * into. Paired with AZURE_TENANT_ID it selects workload identity
   * federation over the ambient credential chain; there is deliberately no
   * client-secret variable, because the Vercel OIDC token is the assertion.
   */
  AZURE_CLIENT_ID: z.string().uuid().optional(),
  AZURE_SUBSCRIPTION_ID: z.string().uuid().optional(),
  AZURE_RESOURCE_GROUP: z.string().min(1).optional(),
  /** Pins host resolution to one VM; unset resolves through the stack tags. */
  AZURE_HOST_VM_NAME: z.string().min(1).optional(),
  /** Enables durable multi-host placement; unset keeps the single-host path. */
  CODEV_RUNTIME_HOST_POOL_ENABLED: z.enum(["true", "false"]).optional(),
  /**
   * HTTPS path to the Firecracker host's orchestrator: a Caddy route on the
   * host, gated by ORCHESTRATOR_DIRECT_SECRET since the orchestrator performs
   * no request authentication of its own.
   *
   * It is named "direct" because it began as a bypass around the API Gateway
   * + Lambda proxy that fronted the EC2 host, whose hard 29-second
   * integration timeout could not carry an authenticated Codex turn (up to
   * 900s). That proxy is gone; this is now simply the path.
   */
  ORCHESTRATOR_DIRECT_URL: optionalUrl,
  ORCHESTRATOR_DIRECT_SECRET: z.string().min(32).optional(),
  HOCUSPOCUS_TOKEN_SECRET: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function readServerEnvironment(
  input: Record<string, string | undefined> = process.env,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(input);
}

export function isGitHubAuthConfigured(
  input: Record<string, string | undefined> = process.env,
) {
  // Production must have the managed key. Without it, a deployment falls
  // through to the development key and writes credentials the platform
  // cannot protect.
  const productionStorageReady =
    input.NODE_ENV !== "production" || input.CREDENTIAL_KEY_VAULT_KEY_ID;

  return Boolean(
    input.AUTH_SECRET &&
    input.AUTH_GITHUB_ID &&
    input.AUTH_GITHUB_SECRET &&
    input.CREDENTIAL_ENCRYPTION_KEY &&
    productionStorageReady,
  );
}

export function isGoogleAuthConfigured(
  input: Record<string, string | undefined> = process.env,
) {
  return Boolean(
    input.AUTH_SECRET && input.AUTH_GOOGLE_ID && input.AUTH_GOOGLE_SECRET,
  );
}
