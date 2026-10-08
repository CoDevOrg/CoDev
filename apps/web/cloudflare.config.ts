import {
  bindings,
  defineConfig,
  defineWorker,
  exports as workerExports,
  triggers,
} from "cf/config";

const azureOrigin = process.env.AZURE_WEB_ORIGIN;

export default defineConfig({
  worker: defineWorker({
    name: "codev-cloudflare-preview",
    domains: azureOrigin ? [] : ["trycodev.com", "www.trycodev.com"],
    workersDev: true,
    entrypoint: "./lib/platform/cloudflare-worker.ts",
    exports: {
      ArmWorkspaceLifecycleWorkflow: workerExports.workflow({
        name: "codev-arm-workspace-lifecycle",
      }),
    },
    compatibilityDate: "2026-09-28",
    compatibilityFlags: ["nodejs_compat"],
    triggers: azureOrigin
      ? []
      : [
          triggers.fetch({
            pattern: "admins.trycodev.com/*",
            zone: "trycodev.com",
          }),
          triggers.scheduled({ schedule: "* * * * *" }),
        ],
    assets: { notFoundHandling: "none" },

    observability: {
      enabled: true,
      logs: {
        enabled: true,
        invocationLogs: true,
        persist: true,
        headSamplingRate: 1,
      },
    },

    env: {
      ...(azureOrigin ? { AZURE_WEB_ORIGIN: bindings.text(azureOrigin) } : {}),
      GEN2_FREE_ARM_ENABLED: bindings.text(
        process.env.GEN2_FREE_ARM_ENABLED ?? "false",
      ),
      GEN2_FREE_ARM_OWNER_IDS: bindings.text(
        process.env.GEN2_FREE_ARM_OWNER_IDS ?? "",
      ),
      VERCEL_ENV: bindings.secret(),
      ACCESS_REQUEST_NOTIFY_EMAIL: bindings.secret(),
      AUTH_GITHUB_ID: bindings.secret(),
      AUTH_GITHUB_SECRET: bindings.secret(),
      AUTH_GOOGLE_ID: bindings.secret(),
      AUTH_GOOGLE_SECRET: bindings.secret(),
      AUTH_SECRET: bindings.secret(),
      AWS_REGION: bindings.secret(),
      AZURE_CLIENT_ID: bindings.secret(),
      AZURE_CLIENT_SECRET: bindings.secret(),
      ARM_WORKSPACE_BOOT_ENABLED: bindings.text(
        process.env.ARM_WORKSPACE_BOOT_ENABLED ?? "false",
      ),
      ARM_WORKSPACE_RESOURCE_GROUP: bindings.secret(),
      ARM_WORKSPACE_AZURE_CLIENT_ID: bindings.secret(),
      ARM_WORKSPACE_AZURE_CLIENT_SECRET: bindings.secret(),
      ARM_WORKSPACE_IMAGE_VERSION_ID: bindings.secret(),
      ARM_WORKSPACE_SSH_PUBLIC_KEY: bindings.secret(),
      ARM_WORKSPACE_SIGNING_PRIVATE_KEY: bindings.secret(),
      ARM_WORKSPACE_SIGNING_PUBLIC_KEY: bindings.secret(),
      AZURE_HOST_VM_NAME: bindings.secret(),
      AZURE_TENANT_ID: bindings.secret(),
      AZURE_RESOURCE_GROUP: bindings.secret(),
      AZURE_SUBSCRIPTION_ID: bindings.secret(),
      CREDENTIAL_ENCRYPTION_KEY: bindings.secret(),
      CREDENTIAL_KEY_VAULT_KEY_ID: bindings.secret(),
      FEEDBACK_GITHUB_REPO: bindings.secret(),
      FEEDBACK_GITHUB_TOKEN: bindings.secret(),
      GITHUB_APP_SLUG: bindings.secret(),
      KV_REST_API_READ_ONLY_TOKEN: bindings.secret(),
      KV_REST_API_TOKEN: bindings.secret(),
      KV_REST_API_URL: bindings.secret(),
      KV_URL: bindings.secret(),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: bindings.secret(),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: bindings.secret(),
      NEXT_PUBLIC_SUPABASE_URL: bindings.secret(),
      ORCHESTRATOR_DIRECT_SECRET: bindings.secret(),
      ORCHESTRATOR_DIRECT_URL: bindings.secret(),
      POSTGRES_DATABASE: bindings.secret(),
      POSTGRES_HOST: bindings.secret(),
      POSTGRES_PASSWORD: bindings.secret(),
      POSTGRES_PRISMA_URL: bindings.secret(),
      POSTGRES_URL: bindings.secret(),
      POSTGRES_URL_NON_POOLING: bindings.secret(),
      POSTGRES_USER: bindings.secret(),
      REDIS_URL: bindings.secret(),
      SIGNUP_ALLOWLIST: bindings.secret(),
      STRIPE_BILLING_SECRETS: bindings.secret(),
      SUPABASE_ANON_KEY: bindings.secret(),
      SUPABASE_JWT_SECRET: bindings.secret(),
      SUPABASE_PUBLISHABLE_KEY: bindings.secret(),
      SUPABASE_SECRET_KEY: bindings.secret(),
      SUPABASE_SERVICE_ROLE_KEY: bindings.secret(),
      SUPABASE_URL: bindings.secret(),
      VERCEL_OIDC_TOKEN: bindings.secret(),
      CODEV_SUPERSET_FILE_PANE_ENABLED: bindings.secret(),
      CODEV_SUPERSET_RUNTIME_ENABLED: bindings.secret(),
      CODEV_SUPERSET_AGENT_SESSIONS_ENABLED: bindings.secret(),
      CRON_SECRET: bindings.secret(),
      CLOUDFLARE_API_TOKEN: bindings.secret(),
      GEN2_ARM_WORKSPACE_LIFECYCLE: bindings.workflow({
        name: "codev-arm-workspace-lifecycle",
        worker: "codev-cloudflare-preview",
        exportName: "ArmWorkspaceLifecycleWorkflow",
      }),
      HYPERDRIVE: bindings.hyperdrive({
        id: "b8b29815a6154e37ab4ecdf4c81c08f4",
      }),
      ASSETS: bindings.assets(),
    },
  }),
});
