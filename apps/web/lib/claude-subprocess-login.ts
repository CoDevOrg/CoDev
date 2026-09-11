import "server-only";

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ClaudeLoginRunner } from "./claude-connection-session";
import {
  decodeClaudeRuntimeReference,
  encodeClaudeRuntimeReference,
} from "./claude-runtime-reference";

type Login = {
  kill: () => void;
  write: (value: string) => void;
  exited: boolean;
  exitCode?: number;
  url?: string;
  buffer: string;
  timer?: ReturnType<typeof setTimeout>;
};
// Next bundles route handlers separately and reloads modules in development.
// Keep live children shared within the process, not in a per-module Map.
const state = globalThis as typeof globalThis & {
  codevClaudeLogins?: Map<string, Login>;
};
const logins = (state.codevClaudeLogins ??= new Map<string, Login>());
const run = promisify(execFile);
const authStatus = z.object({
  loggedIn: z.literal(true),
  authMethod: z.literal("claude.ai"),
});

function executable() {
  if (process.env.CLAUDE_CONNECTION_RUNNER_COMMAND)
    return process.env.CLAUDE_CONNECTION_RUNNER_COMMAND;
  const npmBinary = join(
    process.env.APPDATA ?? homedir(),
    "npm",
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "bin",
    "claude.exe",
  );
  return process.platform === "win32" && existsSync(npmBinary)
    ? npmBinary
    : "claude";
}

export function claudeProfilePath(profileId: string) {
  z.uuid().parse(profileId);
  return join(
    resolve(
      process.env.CODEV_CLAUDE_PROFILE_ROOT ??
        join(homedir(), ".codev", "claude-profiles"),
    ),
    profileId,
  );
}

export function claudeLoginEnvironment(profile: string) {
  const env: Record<string, string> = {};
  // Do not inherit provider tokens, API endpoints, hooks, or credential helpers.
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "LANG",
    "CLAUDE_CODE_GIT_BASH_PATH",
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    NODE_ENV: "production" as const,
    CLAUDE_CONFIG_DIR: join(profile, "config"),
    CI: "1",
    NO_COLOR: "1",
  };
}

async function authenticated(profile: string) {
  if (!existsSync(profile)) return false;
  try {
    const result = await run(executable(), ["auth", "status"], {
      cwd: profile,
      env: claudeLoginEnvironment(profile),
      timeout: 10000,
      maxBuffer: 16384,
      windowsHide: true,
    });
    return authStatus.safeParse(JSON.parse(result.stdout)).success;
  } catch {
    return false;
  }
}

function absorb(login: Login, chunk: string) {
  if (login.url) return;
  // Only the official authorization URL leaves this transport. No terminal
  // output (including pasted codes) is logged or returned to the application.
  login.buffer = (login.buffer + chunk).slice(-32768);
  const text = login.buffer.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const match of text.matchAll(
    /https:\/\/[^\x00-\x20'"\x7f]+(?=[\x00-\x20'"\x7f])/g,
  )) {
    try {
      const url = new URL(match[0]);
      if (
        [
          "claude.com",
          "claude.ai",
          "platform.claude.com",
          "console.anthropic.com",
        ].includes(url.hostname) &&
        /oauth|authorize/.test(url.pathname)
      ) {
        login.url = url.toString();
        return;
      }
    } catch {
      /* Wait for a complete URL. */
    }
  }
}

export const subprocessClaudeRunner: ClaudeLoginRunner = {
  async start({ sessionId }) {
    const profile = claudeProfilePath(sessionId);
    const runnerId = encodeClaudeRuntimeReference({
      version: 1,
      backend: "subprocess",
      profileId: sessionId,
    });
    const existing = logins.get(sessionId);
    if (existing?.url) return { runnerId, authorizeUrl: existing.url };
    await mkdir(join(profile, "config"), { recursive: true, mode: 0o700 });
    const login: Login = { kill() {}, write() {}, exited: false, buffer: "" };
    logins.set(sessionId, login);
    const closed = (code: number | null) => {
      login.exited = true;
      login.exitCode = code ?? 1;
      login.buffer = "";
    };
    try {
      const args = ["auth", "login", "--claudeai"];
      const env = claudeLoginEnvironment(profile);
      if (process.platform === "win32") {
        const pty = await import("node-pty");
        const child = pty.spawn(executable(), args, {
          cwd: profile,
          env,
          cols: 4096,
          rows: 24,
          name: "xterm-256color",
          useConptyDll: true,
        });
        login.kill = () => child.kill();
        login.write = (code) => child.write(`${code}\r`);
        child.onData((chunk) => absorb(login, chunk));
        child.onExit(({ exitCode }) => closed(exitCode));
      } else {
        const child = spawn(executable(), args, {
          cwd: profile,
          env,
          stdio: "pipe",
        });
        login.kill = () => {
          child.kill("SIGKILL");
        };
        login.write = (code) => {
          child.stdin.write(`${code}\n`);
        };
        child.stdout.on("data", (chunk: Buffer) =>
          absorb(login, chunk.toString()),
        );
        child.stderr.on("data", (chunk: Buffer) =>
          absorb(login, chunk.toString()),
        );
        child.on("close", closed);
        child.on("error", () => closed(1));
      }
      login.timer = setTimeout(() => {
        void subprocessClaudeRunner.dispose({ runnerId }).catch(() => {});
      }, 10 * 60000);
      login.timer.unref();
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (login.url) return { runnerId, authorizeUrl: login.url };
        if (login.exited) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(
        "Claude login did not produce an authorization URL. Try connecting again.",
      );
    } catch {
      await subprocessClaudeRunner.dispose({ runnerId });
      throw new Error(
        "Unable to start official Claude login. Check the local Claude executable.",
      );
    }
  },
  async submitCode({ runnerId, code }) {
    const reference = decodeClaudeRuntimeReference(runnerId);
    if (reference.backend !== "subprocess")
      throw new Error("Wrong runtime backend.");
    const login = logins.get(reference.profileId);
    if (!login || login.exited)
      throw new Error("The login process is no longer waiting for a code.");
    if (/[\r\n]/.test(code) || code.length > 16384)
      throw new Error("Invalid authorization code.");
    login.write(code);
  },
  async poll({ runnerId }) {
    const reference = decodeClaudeRuntimeReference(runnerId);
    if (reference.backend !== "subprocess")
      throw new Error("Wrong runtime backend.");
    const login = logins.get(reference.profileId);
    if (login && !login.exited) return { status: "pending" };
    if (
      (!login || login.exitCode === 0) &&
      (await authenticated(claudeProfilePath(reference.profileId)))
    ) {
      clearTimeout(login?.timer);
      logins.delete(reference.profileId);
      return { status: "ready" };
    }
    return {
      status: "failed",
      reason: "Claude is not signed in. Reconnect using the official login.",
    };
  },
  async dispose({ runnerId }) {
    const reference = decodeClaudeRuntimeReference(runnerId);
    if (reference.backend !== "subprocess")
      throw new Error("Wrong runtime backend.");
    const login = logins.get(reference.profileId);
    clearTimeout(login?.timer);
    if (login && !login.exited) {
      try {
        login.kill();
      } catch {
        /* Already stopped. */
      }
    }
    const deadline = Date.now() + 5000;
    while (login && !login.exited && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    if (login && !login.exited)
      throw new Error("Claude login has not stopped; retry disconnect.");
    logins.delete(reference.profileId);
    // UUID-derived path under the dedicated profile root, never a supplied path.
    await rm(claudeProfilePath(reference.profileId), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  },
};
