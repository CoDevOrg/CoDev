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
  AUTH_SECRET: z.string().min(32).optional(),
  AUTH_GITHUB_ID: z.string().min(1).optional(),
  AUTH_GITHUB_SECRET: z.string().min(1).optional(),
  GITHUB_APP_SLUG: z.string().min(1).optional(),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(1).optional(),
  REDIS_URL: optionalUrl,
  AWS_REGION: z.string().min(1).optional(),
  AWS_ROLE_ARN: z.string().startsWith("arn:aws:iam::").optional(),
  ORCHESTRATOR_URL: optionalUrl,
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
  return Boolean(
    input.AUTH_SECRET &&
    input.AUTH_GITHUB_ID &&
    input.AUTH_GITHUB_SECRET &&
    input.CREDENTIAL_ENCRYPTION_KEY,
  );
}
