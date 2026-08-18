import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_API_URL = "https://www.trycodev.com";

export function configPath(environment = process.env) {
  return join(
    environment.CODEV_CONFIG_DIR || join(homedir(), ".codev"),
    "config.json",
  );
}

export function apiUrl(environment = process.env) {
  return (environment.CODEV_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

async function request(path, options = {}, baseUrl = apiUrl()) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) {
    throw new Error(payload.error || `CoDev returned HTTP ${response.status}.`);
  }
  return { response, payload };
}

async function saveConfig(config) {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function loadConfig() {
  try {
    return JSON.parse(await readFile(configPath(), "utf8"));
  } catch {
    throw new Error("Run `codev login` first.");
  }
}

function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const child = spawn(command[0], command.slice(1), {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => undefined);
  child.unref();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function login({ launchBrowser = true } = {}) {
  const { payload } = await request("/api/cli/auth/device", { method: "POST" });
  const verificationUrl = `${payload.verificationUrl}?code=${encodeURIComponent(payload.userCode)}`;
  process.stdout.write(
    `Open ${verificationUrl}\nEnter code: ${payload.userCode}\n`,
  );
  if (launchBrowser) openBrowser(verificationUrl);
  const deadline = new Date(payload.expiresAt).getTime();
  while (Date.now() < deadline) {
    await wait(Math.max(Number(payload.intervalSeconds) || 3, 2) * 1_000);
    const result = await request("/api/cli/auth/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode: payload.deviceCode }),
    });
    if (result.response.status === 202) continue;
    await saveConfig({
      apiUrl: apiUrl(),
      token: result.payload.token,
      expiresAt: result.payload.expiresAt,
    });
    process.stdout.write("CoDev CLI is connected.\n");
    return;
  }
  throw new Error(
    "The CoDev CLI authorization expired. Run `codev login` again.",
  );
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} was stopped by ${signal}.`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} exited with status ${code ?? 1}.`));
    });
  });
}

async function authenticatedRequest(path, options = {}) {
  const config = await loadConfig();
  return request(
    path,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(options.headers || {}),
      },
    },
    (config.apiUrl || apiUrl()).replace(/\/+$/, ""),
  );
}

async function resolveOrganization(organizationId) {
  if (organizationId) return organizationId;
  const { payload } = await authenticatedRequest("/api/cli/organizations");
  const organizations = payload.organizations || [];
  if (organizations.length === 1) return organizations[0].id;
  if (organizations.length === 0) {
    throw new Error(
      "Your account does not maintain an organization workspace.",
    );
  }
  const choices = organizations
    .map((organization) => `  ${organization.id}  ${organization.repository}`)
    .join("\n");
  throw new Error(
    `More than one organization is available. Re-run with --org=<id>:\n${choices}`,
  );
}

export async function codexAuth({
  organization = false,
  organizationId,
  browser = false,
} = {}) {
  await loadConfig();
  const { mkdtemp } = await import("node:fs/promises");
  const codexHome = await mkdtemp(join(tmpdir(), "codev-codex-auth-"));
  await chmod(codexHome, 0o700);
  try {
    const args = [
      "login",
      "-c",
      'cli_auth_credentials_store="file"',
      ...(browser ? [] : ["--device-auth"]),
    ];
    process.stdout.write("Starting the official Codex login flow…\n");
    await run("codex", args, {
      env: { ...process.env, CODEX_HOME: codexHome },
    });
    const authCache = JSON.parse(
      await readFile(join(codexHome, "auth.json"), "utf8"),
    );
    const resolvedOrganizationId = organization
      ? await resolveOrganization(organizationId)
      : undefined;
    await authenticatedRequest("/api/cli/codex-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeType: organization ? "ORGANIZATION" : "USER",
        ...(resolvedOrganizationId
          ? { organizationId: resolvedOrganizationId }
          : {}),
        authCache,
      }),
    });
    process.stdout.write(
      organization
        ? "Codex is connected to the CoDev organization.\n"
        : "Codex is connected to your CoDev account.\n",
    );
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
}
