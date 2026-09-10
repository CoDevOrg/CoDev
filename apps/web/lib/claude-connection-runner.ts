import "server-only";

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { redactClaudeSecrets } from "./claude-connection";
import {
  unavailableClaudeRunner,
  type ClaudeRunnerPollResult,
  type ClaudeSetupTokenRunner,
} from "./claude-connection-session";
import {
  closeClaudeSetupTokenInSandbox,
  destroySandbox,
  ensureHostReady,
  provisionSandbox,
  pollClaudeSetupTokenInSandbox,
  startClaudeSetupTokenInSandbox,
  submitClaudeSetupTokenCodeInSandbox,
} from "./orchestrator";
import { logEvent } from "./observability";

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

// A stream chunk can stop halfway through a token. Wait for its delimiter
// before storing it; otherwise polling can persist a truncated credential.
const TOKEN_PATTERN = /sk-ant-[A-Za-z0-9_-]{20,}(?=[^A-Za-z0-9_-])/;

function urlPattern() {
  const override = process.env.CLAUDE_CONNECTION_URL_PATTERN?.trim();
  if (override) return new RegExp(override, "i");
  // OSC terminal hyperlinks end in BEL/ESC, which are not whitespace.
  return /(https?:\/\/[^\x00-\x20'"\x7f]*(?:oauth|authorize|claude\.ai|anthropic\.com|claude\.com)[^\x00-\x20'"\x7f]*)(?=[\x00-\x20'"\x7f])/i;
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
const ORCHESTRATOR_SESSION_TTL_MS = 10 * 60 * 1_000;
const ORCHESTRATOR_SANDBOX_LIFECYCLE_MS = 4 * 60 * 60 * 1_000;
const EMPTY_AUTH_REPOSITORY_FILE = "Hosted Claude connection runner.\n";

type RunnerProcess = {
  kill: () => void;
  write: (code: string) => void;
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
        proc.kill();
      } catch {
        // already gone
      }
      processes.delete(id);
    }
  }
}

function absorb(proc: RunnerProcess, chunk: string) {
  proc.output += chunk;
  // ConPTY inserts cursor/style controls between writes. They are not token
  // or URL delimiters. Keep the raw buffer so a control split across chunks
  // can be completed on the next read; retain OSC hyperlinks for their URLs.
  const text = proc.output
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*$/, "")
    .replace(/\x1b\](?!8;)[^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\](?!8;)[^\x07]*$/, "");
  if (!proc.token) {
    const match = TOKEN_PATTERN.exec(text);
    if (match) proc.token = match[0];
  }
  if (!proc.authorizeUrl) {
    const match = urlPattern().exec(text);
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
    const proc: RunnerProcess = {
      kill: () => {},
      write: () => {},
      output: "",
      exited: false,
      createdAt: Date.now(),
    };
    // `exit` may arrive before the final stdout chunk; `close` means all
    // output has drained. EOF also terminates a token without a newline.
    const onClose = (code: number | null) => {
      absorb(proc, "\n");
      proc.exited = true;
      if (!proc.token && !proc.failure) {
        proc.failure = `claude setup-token exited with code ${code ?? "unknown"}.`;
      }
    };
    const env = { ...process.env, CI: "1", FORCE_COLOR: "0" };
    if (process.platform === "win32") {
      // The native Windows CLI emits no setup-token output when all stdio
      // handles are pipes. ConPTY gives its interactive login a real terminal.
      // Load lazily: the production orchestrator runner never needs this addon.
      const pty = await import("node-pty");
      const child = pty.spawn(command, args, {
        name: "xterm-256color",
        useConptyDll: true,
        // This terminal is a transport, not a visible panel. Keep long OAuth
        // URLs and tokens on one line so ConPTY cannot wrap their contents.
        cols: 4096,
        rows: 24,
        cwd: process.cwd(),
        env,
      });
      proc.kill = () => child.kill();
      proc.write = (code) => child.write(`${code}\r`);
      child.onData((chunk) => absorb(proc, chunk));
      child.onExit(({ exitCode }) => onClose(exitCode));
    } else {
      const child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env,
      }) as ChildProcessWithoutNullStreams;
      proc.kill = () => {
        child.kill("SIGKILL");
      };
      proc.write = (code) => {
        child.stdin.write(`${code}\n`);
      };
      child.stdout.on("data", (d: Buffer) => absorb(proc, d.toString()));
      child.stderr.on("data", (d: Buffer) => absorb(proc, d.toString()));
      child.on("error", (error) => {
        proc.failure = error.message;
        proc.exited = true;
      });
      child.on("close", onClose);
    }
    processes.set(sessionId, proc);

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
      proc.kill();
    } catch {
      // already gone
    }
    processes.delete(sessionId);
    throw new Error(
      "Claude did not print an authorization URL within 30 seconds. Check that the configured Claude executable can run setup-token and reach Anthropic, then try again.",
    );
  },

  async submitCode({ runnerId, code }) {
    const proc = processes.get(runnerId);
    if (!proc || proc.exited) {
      throw new Error("The connection runner is no longer active.");
    }
    proc.write(code);
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
      if (!proc.exited) proc.kill();
    } catch {
      // already gone
    }
    processes.delete(runnerId);
  },
};

function encodeOrchestratorRunnerId(workspaceId: string, sessionId: string) {
  return `${workspaceId}:${sessionId}`;
}

function decodeOrchestratorRunnerId(runnerId: string) {
  const [workspaceId, sessionId, extra] = runnerId.split(":");
  if (!workspaceId || !sessionId || extra !== undefined) {
    throw new Error("The Claude connection runner id is invalid.");
  }
  return { workspaceId, sessionId };
}

export const orchestratorClaudeRunner: ClaudeSetupTokenRunner = {
  async start({ sessionId }) {
    const workspaceId = sessionId;
    let sandboxCreated = false;
    const startedAt = Date.now();
    try {
      // The host stops itself after ten minutes idle, so connecting Claude
      // after any quiet period arrives at a stopped instance. Without this the
      // provision below raced the boot and reported "Firecracker host
      // unavailable" on the first click.
      await ensureHostReady();
      await provisionSandbox({
        workspaceId,
        repositoryUrl: null,
        repositorySnapshot: {
          files: [
            {
              path: "README.md",
              mode: "100644",
              contentBase64: Buffer.from(
                EMPTY_AUTH_REPOSITORY_FILE,
                "utf8",
              ).toString("base64"),
            },
          ],
          totalBytes: Buffer.byteLength(EMPTY_AUTH_REPOSITORY_FILE),
        },
        baseSha: "0".repeat(40),
        expiresAt: new Date(
          Date.now() + ORCHESTRATOR_SESSION_TTL_MS,
        ).toISOString(),
        resumeFromSnapshot: false,
        lifecycle: {
          timeoutMs: ORCHESTRATOR_SANDBOX_LIFECYCLE_MS,
          lifecycle: { onTimeout: "pause", autoResume: true },
        },
      });
      sandboxCreated = true;
      const provisionedAt = Date.now();
      const started = await startClaudeSetupTokenInSandbox(workspaceId, {
        idempotencyKey: sessionId,
      });
      logEvent("info", "claude_connection.runner_started", {
        runner: "orchestrator",
        workspaceId,
        provisionMs: provisionedAt - startedAt,
        urlMs: Date.now() - provisionedAt,
        claudeVersion: started.claudeVersion,
      });
      return {
        runnerId: encodeOrchestratorRunnerId(workspaceId, started.sessionId),
        authorizeUrl: started.authorizeUrl,
      };
    } catch (error) {
      if (sandboxCreated) await destroySandbox(workspaceId).catch(() => {});
      logEvent("warn", "claude_connection.runner_start_failed", {
        runner: "orchestrator",
        workspaceId,
        durationMs: Date.now() - startedAt,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  async submitCode({ runnerId, code }) {
    const { workspaceId, sessionId } = decodeOrchestratorRunnerId(runnerId);
    await submitClaudeSetupTokenCodeInSandbox(workspaceId, sessionId, code);
    logEvent("info", "claude_connection.runner_code_submitted", {
      runner: "orchestrator",
      workspaceId,
      sessionId,
    });
  },

  async poll({ runnerId }): Promise<ClaudeRunnerPollResult> {
    const { workspaceId, sessionId } = decodeOrchestratorRunnerId(runnerId);
    const result = await pollClaudeSetupTokenInSandbox(workspaceId, sessionId);
    if (result.status !== "pending") {
      logEvent("info", "claude_connection.runner_terminal", {
        runner: "orchestrator",
        workspaceId,
        sessionId,
        status: result.status,
        reason: result.status === "failed" ? result.reason : undefined,
      });
    }
    return result;
  },

  async dispose({ runnerId }) {
    const { workspaceId, sessionId } = decodeOrchestratorRunnerId(runnerId);
    await closeClaudeSetupTokenInSandbox(workspaceId, sessionId).catch(
      () => {},
    );
    await destroySandbox(workspaceId).catch(() => {});
  },
};

/**
 * Pick the runner for this deployment. `subprocess` opts into the local
 * child-process runner above; anything else (the default) leaves hosted
 * connect disabled so the flow falls back to an API key / the CoDev CLI.
 */
export function resolveClaudeRunner(): ClaudeSetupTokenRunner {
  const runner = process.env.CLAUDE_CONNECTION_RUNNER?.trim();
  if (runner === "subprocess") {
    return subprocessClaudeRunner;
  }
  if (runner === "orchestrator") return orchestratorClaudeRunner;
  return unavailableClaudeRunner;
}

/**
 * Whether the in-app "Connect Claude" flow can actually run. When false the
 * settings UI shows only the API-key and CoDev CLI paths.
 */
export function isHostedClaudeConnectEnabled(): boolean {
  return resolveClaudeRunner() !== unavailableClaudeRunner;
}
