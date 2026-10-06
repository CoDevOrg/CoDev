import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const temporary = mkdtempSync(join(tmpdir(), "codev-azure-web-"));
const resourceGroup = "codev-web-production";
const registry = "codevwebprod8ad43";
const release =
  process.env.GITHUB_SHA ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const base = JSON.parse(
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
  VERCEL_GIT_COMMIT_SHA: release,
};
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

async function verify(hostname) {
  const response = await fetch(`https://${hostname}/api/ready`, {
    headers: {
      "x-codev-origin-secret": values.AZURE_WEB_ORIGIN_SECRET,
      "x-codev-public-host": "www.trycodev.com",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Azure readiness failed: ${response.status}`);
  const readiness = await response.json();
  if (readiness.release !== release)
    throw new Error("Azure readiness returned a different release.");
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
    env: runtime,
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
