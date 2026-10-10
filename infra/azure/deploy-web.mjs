import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const temporary = mkdtempSync(join(tmpdir(), "codev-azure-web-"));
const resourceGroup = "codev-web-production";
const registry = "codevwebprod8ad43";
const release =
  process.env.GITHUB_SHA ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const { WORKFLOW_POSTGRES_ADMIN_URL, ...base } = JSON.parse(
  process.env.AZURE_WEB_RUNTIME_SECRETS ||
    readFileSync(".codev-local/azure-web-secrets.json", "utf8"),
);
const values = {
  ...base,
  ...JSON.parse(process.env.ARM_WORKSPACE_RUNTIME_SECRETS || "{}"),
  ...JSON.parse(process.env.STRIPE_BILLING_SECRETS || "{}"),
  CRON_SECRET: process.env.CRON_SECRET || base.CRON_SECRET,
  AZURE_WEB_ORIGIN_SECRET:
    process.env.AZURE_WEB_ORIGIN_SECRET || base.AZURE_WEB_ORIGIN_SECRET,
  GEN2_FREE_ARM_ENABLED:
    process.env.GEN2_FREE_ARM_ENABLED || base.GEN2_FREE_ARM_ENABLED,
  GEN2_FREE_ARM_OWNER_IDS:
    process.env.GEN2_FREE_ARM_OWNER_IDS ?? base.GEN2_FREE_ARM_OWNER_IDS,
  ARM_WORKSPACE_BOOT_ENABLED:
    process.env.ARM_WORKSPACE_BOOT_ENABLED || base.ARM_WORKSPACE_BOOT_ENABLED,
  // Agent coordination rolls out per workspace; an empty variable turns it off.
  CODEV_AGENT_COORDINATION_WORKSPACES:
    process.env.CODEV_AGENT_COORDINATION_WORKSPACES ??
    base.CODEV_AGENT_COORDINATION_WORKSPACES,
  // Cursor joins Superset agent sessions only after every guest can host it.
  CODEV_SUPERSET_CURSOR_AGENTS_ENABLED:
    process.env.CODEV_SUPERSET_CURSOR_AGENTS_ENABLED ??
    base.CODEV_SUPERSET_CURSOR_AGENTS_ENABLED,
  // Browser previews stay off until both the zone and its Cloudflare id are set.
  CODEV_PREVIEW_ZONE: process.env.CODEV_PREVIEW_ZONE ?? base.CODEV_PREVIEW_ZONE,
  CODEV_PREVIEW_ZONE_ID:
    process.env.CODEV_PREVIEW_ZONE_ID ?? base.CODEV_PREVIEW_ZONE_ID,
  // A non-secret repository variable promotes images without rewriting the
  // write-only ARM credential bundle; the bundle's pin is the fallback.
  ...(process.env.ARM_WORKSPACE_IMAGE_VERSION_ID && {
    ARM_WORKSPACE_IMAGE_VERSION_ID: process.env.ARM_WORKSPACE_IMAGE_VERSION_ID,
  }),
  VERCEL_GIT_COMMIT_SHA: release,
};
// Releases set the catalog's Codex version together with the image pin, so
// the catalog matches the promoted image's CLI.
const codexCatalog = process.env.CODEX_CATALOG_CLIENT_VERSION;
if (codexCatalog && !/^\d+\.\d+\.\d+$/.test(codexCatalog))
  throw new Error("CODEX_CATALOG_CLIENT_VERSION must be a Codex version.");
if (codexCatalog) values.CODEX_CATALOG_CLIENT_VERSION = codexCatalog;
// Runtime config rejects any other shape; fail before anything is deployed.
if (
  values.ARM_WORKSPACE_IMAGE_VERSION_ID &&
  !/^\/subscriptions\/[^/]+\/resourceGroups\/codev-arm-workspace-[a-z0-9-]+\/providers\/Microsoft\.Compute\/galleries\/[^/]+\/images\/[^/]+\/versions\/\d+\.\d+\.\d+$/.test(
    values.ARM_WORKSPACE_IMAGE_VERSION_ID,
  )
)
  throw new Error(
    "ARM_WORKSPACE_IMAGE_VERSION_ID must be a gallery image version in a lowercase codev-arm-workspace-* resource group.",
  );
// Auth.js must retain the authenticated public host for host-only session cookies.
// The existing redirect proxy carries OAuth callbacks back to that host.
delete values.AUTH_URL;
delete values.NEXTAUTH_URL;
if (!values.AZURE_WEB_ORIGIN_SECRET || !values.WORKFLOW_POSTGRES_URL)
  throw new Error("Azure runtime configuration is missing.");

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: "inherit", ...options });
}

/** Upload tracked source only: never include local environment files or credentials. */
function sourceContext() {
  const context = join(temporary, "source");
  mkdirSync(context);
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    const destination = join(context, file);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(file, destination, { recursive: true });
  }
  return context;
}

function parameters(image) {
  const path = join(temporary, "parameters.json");
  writeFileSync(
    path,
    JSON.stringify({
      $schema:
        "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
      contentVersion: "1.0.0.0",
      parameters: { image: { value: image }, runtimeValues: { value: values } },
    }),
    { mode: 0o600 },
  );
  return path;
}

async function waitForRelease(hostname) {
  const deadline = Date.now() + 300_000;
  console.log("Waiting for the new Azure revision to become ready...");
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`https://${hostname}/api/ready`, {
        headers: {
          "x-codev-origin-secret": values.AZURE_WEB_ORIGIN_SECRET,
          "x-codev-public-host": "www.trycodev.com",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const readiness = await response.json();
        if (readiness.status === "ready" && readiness.release === release)
          return;
      } else {
        await response.body?.cancel();
      }
    } catch {
      // Image pull, startup, and ingress replacement can outlive ARM deployment.
    }
    await delay(5_000);
  }
  throw new Error(
    "Azure did not serve the expected ready release within five minutes.",
  );
}

async function verify(hostname) {
  await waitForRelease(hostname);
  const direct = await fetch(`https://${hostname}/gen2`, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  await direct.body?.cancel();
  if (direct.status !== 403)
    throw new Error(
      "Azure origin accepted a request without proxy authorization.",
    );
  console.log(`Azure web release ${release} is ready at ${hostname}`);
}

try {
  const runtime = { ...process.env, ...values };
  run("pnpm", ["db:check"], { env: runtime });
  run("pnpm", ["--filter", "@codev/web", "exec", "bootstrap"], {
    env: {
      ...runtime,
      WORKFLOW_POSTGRES_URL:
        WORKFLOW_POSTGRES_ADMIN_URL || values.WORKFLOW_POSTGRES_URL,
    },
  });
  const tag = `codev-web:${release}`;
  run("az", [
    "acr",
    "build",
    "--registry",
    registry,
    "--image",
    tag,
    "--file",
    "infra/azure/web.Containerfile",
    "--build-arg",
    `NEXT_PUBLIC_SUPABASE_URL=${values.NEXT_PUBLIC_SUPABASE_URL || ""}`,
    "--build-arg",
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ""}`,
    "--no-logs",
    sourceContext(),
  ]);
  const hostname = run(
    "az",
    [
      "deployment",
      "group",
      "create",
      "--resource-group",
      resourceGroup,
      "--name",
      `web-${release.slice(0, 12)}`,
      "--template-file",
      "infra/azure/web-app.bicep",
      "--parameters",
      `@${parameters(`${registry}.azurecr.io/${tag}`)}`,
      "--query",
      "properties.outputs.hostname.value",
      "-o",
      "tsv",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
  await verify(hostname);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
