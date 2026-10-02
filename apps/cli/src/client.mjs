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

const INSTALL_HINT = {
  codex: "npm install -g @openai/codex",
  claude: "npm install -g @anthropic-ai/claude-code",
  agent: "curl https://cursor.com/install -fsS | bash",
};

export function describeSpawnError(command, error) {
  if (error?.code === "ENOENT") {
    const hint = INSTALL_HINT[command];
    return new Error(
      `${command} is not installed or not on PATH.${hint ? ` Install it with \`${hint}\`.` : ""} If a global npm install fails with EACCES, first run \`npm config set prefix "$HOME/.npm-global"\` and add \`$HOME/.npm-global/bin\` to PATH.`,
    );
  }
  return error;
}

export function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.on("error", (error) => reject(describeSpawnError(command, error)));
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} was stopped by ${signal}.`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} exited with status ${code ?? 1}.`));
    });
  });
}

/** Runs a command, streaming its stdout to the terminal while also capturing it. */
function runCapture(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["inherit", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.on("error", (error) => reject(describeSpawnError(command, error)));
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} was stopped by ${signal}.`));
      else if (code === 0) resolve(output);
      else reject(new Error(`${command} exited with status ${code ?? 1}.`));
    });
  });
}

const CLAUDE_TOKEN_PATTERN = /sk-ant-[A-Za-z0-9_-]{20,}/;

export function extractClaudeOAuthToken(output) {
  const match = CLAUDE_TOKEN_PATTERN.exec(output);
  return match ? match[0] : undefined;
}

export async function authenticatedRequest(path, options = {}) {
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

export async function codexAuth({ browser = false } = {}) {
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
    await authenticatedRequest("/api/cli/codex-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authCache }),
    });
    process.stdout.write("Codex is connected to your CoDev account.\n");
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
}

export async function claudeAuth() {
  await loadConfig();
  process.stdout.write("Starting the official Claude Code login flow…\n");
  const output = await runCapture("claude", ["setup-token"]);
  const oauthToken = extractClaudeOAuthToken(output);
  if (!oauthToken) {
    throw new Error(
      "Could not read the token from `claude setup-token`. Run it manually and try again.",
    );
  }
  await authenticatedRequest("/api/cli/claude-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oauthToken }),
  });
  process.stdout.write("Claude Code is connected to your CoDev account.\n");
}

/** Paths `agent login` may write when the credential store is a file. */
export function cursorAuthFileCandidates(home) {
  return [
    join(home, ".cursor", "auth.json"),
    join(home, ".config", "cursor", "auth.json"),
  ];
}

async function readCursorAuthFile(home) {
  for (const path of cursorAuthFileCandidates(home)) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(
    "Could not read Cursor's auth.json after `agent login`. Run it again with the file credential store.",
  );
}

export async function cursorAuth() {
  await loadConfig();
  const { mkdtemp } = await import("node:fs/promises");
  const home = await mkdtemp(join(tmpdir(), "codev-cursor-auth-"));
  await chmod(home, 0o700);
  try {
    process.stdout.write("Starting the official Cursor CLI login…\n");
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      AGENT_CLI_CREDENTIAL_STORE: "file",
    };
    delete env.CURSOR_API_KEY;
    await run("agent", ["login"], { env });
    const auth = await readCursorAuthFile(home);
    await authenticatedRequest("/api/cli/cursor-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth }),
    });
    process.stdout.write("Cursor is connected to your CoDev account.\n");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
