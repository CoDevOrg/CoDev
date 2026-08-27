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
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
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
  GITHUB_APP_SLUG: z.string().min(1).optional(),
  FEEDBACK_GITHUB_TOKEN: z.string().min(1).optional(),
  FEEDBACK_GITHUB_REPO: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/)
    .optional(),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(1).optional(),
  CREDENTIAL_KMS_KEY_ID: z.string().min(1).optional(),
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
  WAITLIST_MODE_DISABLED: z.enum(["true", "false"]).optional(),
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  REDIS_URL: optionalUrl,
  AWS_REGION: z.string().min(1).optional(),
  AWS_ROLE_ARN: z.string().startsWith("arn:aws:iam::").optional(),
  AWS_HOST_INSTANCE_ID: z
    .string()
    .regex(/^i-[0-9a-f]+$/)
    .optional(),
  ORCHESTRATOR_URL: optionalUrl,
  /**
   * Direct HTTPS path to the Firecracker host's orchestrator, bypassing the
   * API Gateway + Lambda proxy fronted by ORCHESTRATOR_URL. That proxy has a
   * hard, non-configurable 29-second timeout (an AWS platform limit on
   * Lambda proxy integrations), which is incompatible with long-running
   * calls like an authenticated Codex CLI turn (up to 900s). This path goes
   * straight to a Caddy route on the host instead, gated by
   * ORCHESTRATOR_DIRECT_SECRET since the orchestrator itself performs no
   * request authentication of its own (it normally relies on the Lambda's
   * security-group-restricted network path).
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
  const productionStorageReady =
    input.NODE_ENV !== "production" || input.CREDENTIAL_KMS_KEY_ID;

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
