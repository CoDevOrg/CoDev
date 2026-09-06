import "server-only";

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { redactClaudeSecrets } from "./claude-connection";
import {
  unavailableClaudeRunner,
  type ClaudeRunnerPollResult,
  type ClaudeSetupTokenRunner,
} from "./claude-connection-session";

/**
 * Runs the official `claude setup-token` binary as a child process and bridges
 * its interactive prompts: it prints an authorization URL, waits for the member
 * to paste the code Anthropic hands back on stdin, then prints an `sk-ant-oat…`
 * token.
 *
 * State (the live child processes) lives in an in-process map, so this runner
 * needs a single long-lived Node process — fine for local dev and a
 * single-instance self-host, NOT for Vercel serverless where each request may
 * land on a fresh lambda. The production target is a dedicated worker that
 * implements this same {@link ClaudeSetupTokenRunner} interface; swapping it in
 * is a one-line change in {@link resolveClaudeRunner}.
 */

const TOKEN_PATTERN = /sk-ant-[A-Za-z0-9_-]{20,}/;

function urlPattern() {
  const override = process.env.CLAUDE_CONNECTION_URL_PATTERN?.trim();
  if (override) return new RegExp(override, "i");
  return /(https?:\/\/[^\s'"]*(?:oauth|authorize|claude\.ai|anthropic\.com|claude\.com)[^\s'"]*)/i;
}

function setupCommand(): { command: string; args: string[] } {
  const command =
    process.env.CLAUDE_CONNECTION_RUNNER_COMMAND?.trim() || "claude";
  const rawArgs = process.env.CLAUDE_CONNECTION_RUNNER_ARGS?.trim();
  const args = rawArgs ? JSON.parse(rawArgs) : ["setup-token"];
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
    throw new Error(
      "CLAUDE_CONNECTION_RUNNER_ARGS must be a JSON string array.",
    );
  }
  return { command, args };
}

const START_TIMEOUT_MS = 30_000;
const PROC_TTL_MS = 15 * 60 * 1_000;

type RunnerProcess = {
  child: ChildProcessWithoutNullStreams;
  output: string;
  authorizeUrl?: string;
  token?: string;
  failure?: string;
  exited: boolean;
  createdAt: number;
};

const processes = new Map<string, RunnerProcess>();

function sweep() {
  const cutoff = Date.now() - PROC_TTL_MS;
  for (const [id, proc] of processes) {
    if (proc.createdAt < cutoff) {
      try {
        proc.child.kill("SIGKILL");
      } catch {
        // already gone
      }
      processes.delete(id);
    }
  }
}

function absorb(proc: RunnerProcess, chunk: string) {
  proc.output += chunk;
  if (!proc.token) {
    const match = TOKEN_PATTERN.exec(proc.output);
    if (match) proc.token = match[0];
  }
  if (!proc.authorizeUrl) {
    const match = urlPattern().exec(proc.output);
    if (match?.[1]) proc.authorizeUrl = match[1];
  }
  // Once the whole token is captured, scrub it from the buffered transcript so
  // a later log or error that echoes `proc.output` cannot leak it. Only after
  // capture, so a token split across stream chunks is still matched in full.
  if (proc.token) proc.output = redactClaudeSecrets(proc.output);
}

export const subprocessClaudeRunner: ClaudeSetupTokenRunner = {
  async start({ sessionId }) {
    sweep();
    const { command, args } = setupCommand();
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
    }) as ChildProcessWithoutNullStreams;

    const proc: RunnerProcess = {
      child,
      output: "",
      exited: false,
      createdAt: Date.now(),
    };
    processes.set(sessionId, proc);

    child.stdout.on("data", (d: Buffer) => absorb(proc, d.toString()));
    child.stderr.on("data", (d: Buffer) => absorb(proc, d.toString()));
    child.on("error", (error) => {
      proc.failure = error.message;
      proc.exited = true;
    });
    child.on("exit", (code) => {
      proc.exited = true;
      if (!proc.token && !proc.failure) {
        proc.failure = `claude setup-token exited with code ${code ?? "unknown"}.`;
      }
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (proc.authorizeUrl) {
        return { runnerId: sessionId, authorizeUrl: proc.authorizeUrl };
      }
      if (proc.exited) {
        processes.delete(sessionId);
        throw new Error(
          proc.failure ?? "claude setup-token exited before printing a URL.",
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
    processes.delete(sessionId);
    throw new Error("Timed out waiting for claude setup-token to start.");
  },

  async submitCode({ runnerId, code }) {
    const proc = processes.get(runnerId);
    if (!proc || proc.exited) {
      throw new Error("The connection runner is no longer active.");
    }
    proc.child.stdin.write(`${code}\n`);
  },

  async poll({ runnerId }): Promise<ClaudeRunnerPollResult> {
    const proc = processes.get(runnerId);
    if (!proc)
      return { status: "failed", reason: "The connection runner was lost." };
    if (proc.token) return { status: "ready", oauthToken: proc.token };
    if (proc.exited) {
      return {
        status: "failed",
        reason: proc.failure ?? "The connection runner stopped unexpectedly.",
      };
    }
    return { status: "pending" };
  },

  async dispose({ runnerId }) {
    const proc = processes.get(runnerId);
    if (!proc) return;
    try {
      proc.child.kill("SIGKILL");
    } catch {
      // already gone
    }
    processes.delete(runnerId);
  },
};

/**
 * Pick the runner for this deployment. `subprocess` opts into the local
 * child-process runner above; anything else (the default) leaves hosted
 * connect disabled so the flow falls back to an API key / the CoDev CLI.
 */
export function resolveClaudeRunner(): ClaudeSetupTokenRunner {
  if (process.env.CLAUDE_CONNECTION_RUNNER?.trim() === "subprocess") {
    return subprocessClaudeRunner;
  }
  return unavailableClaudeRunner;
}

/**
 * Whether the in-app "Connect Claude" flow can actually run. When false the
 * settings UI shows only the API-key and CoDev CLI paths.
 */
export function isHostedClaudeConnectEnabled(): boolean {
  return resolveClaudeRunner() !== unavailableClaudeRunner;
}
