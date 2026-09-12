import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getConnectedClaudeRuntime } from "./claude-connection-session";
import { logEvent } from "./observability";
import {
  decodeClaudeRuntimeReference,
  claudeRuntimeReferenceSchema,
} from "./claude-runtime-reference";
import {
  claudeExecutable,
  claudeLoginEnvironment,
  claudeProfilePath,
} from "./claude-subprocess-login";
import {
  claimClaudeSubscriptionExecution,
  releaseClaudeSubscriptionExecution,
} from "./claude-subscription-execution";
import {
  ensureHostReady,
  provisionSandbox,
  getSandbox,
  startCodexExecInSandbox,
  pollCodexExecInSandbox,
  closeCodexExecInSandbox,
  snapshotWorkspace,
  destroySandbox,
} from "./orchestrator";

// Official CLI aliases resolve on the signed-in account; do not claim specific
// dated API models are available to every subscription.
export const CLAUDE_RUNTIME_MODELS = ["sonnet", "opus", "haiku"];
const runSchema = z.object({
  connectionId: z.uuid(),
  userId: z.string().min(1),
  leaseUntil: z.number(),
  reference: claudeRuntimeReferenceSchema,
  sessionId: z.string().min(1),
});
type Run = z.infer<typeof runSchema>;
type LocalRun = {
  child: ChildProcess;
  chunks: Buffer[];
  size: number;
  exited: boolean;
  exitCode: number | null;
  timer: ReturnType<typeof setTimeout>;
};
const globalState = globalThis as typeof globalThis & {
  codevClaudeExecs?: Map<string, LocalRun>;
};
const localRuns = (globalState.codevClaudeExecs ??= new Map<
  string,
  LocalRun
>());
const prefix = "claude-exec-v1:";
export const isClaudeExecution = (value: string) => value.startsWith(prefix);
function decode(value: string) {
  if (!isClaudeExecution(value))
    throw new Error("Invalid Claude execution reference.");
  return runSchema.parse(
    JSON.parse(Buffer.from(value.slice(prefix.length), "base64url").toString()),
  );
}
function encode(run: Run) {
  return (
    prefix +
    Buffer.from(JSON.stringify(runSchema.parse(run))).toString("base64url")
  );
}

export function claudePrintArgs(model: string, outputSchema?: object) {
  if (!CLAUDE_RUNTIME_MODELS.includes(model))
    throw new Error("Select an official Claude CLI model alias.");
  return [
    "-p",
    "--model",
    model,
    "--output-format",
    "json",
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--max-turns",
    "2",
    ...(outputSchema ? ["--json-schema", JSON.stringify(outputSchema)] : []),
  ];
}

export async function startClaudeExecution(
  userId: string,
  model: string,
  prompt: string,
  requestId: string,
  outputSchema?: object,
) {
  if (Buffer.byteLength(prompt) > 120_000)
    throw new Error("Claude context is too large; shorten the conversation.");
  const args = claudePrintArgs(model, outputSchema);
  const connection = await getConnectedClaudeRuntime(userId);
  if (!connection?.runnerId) throw new Error("Reconnect Claude in Settings.");
  const reference = decodeClaudeRuntimeReference(connection.runnerId);
  const leaseUntil = await claimClaudeSubscriptionExecution(
    connection.id,
    userId,
  );
  let run: Run | undefined;
  try {
    let sessionId: string;
    if (reference.backend === "subprocess") {
      if (process.env.VERCEL)
        throw new Error("Local Claude profiles cannot run on Vercel.");
      const profile = claudeProfilePath(reference.profileId);
      // Prompt goes through stdin to avoid Windows command-line size limits.
      const child = spawn(claudeExecutable(), args, {
        cwd: profile,
        env: claudeLoginEnvironment(profile),
        windowsHide: true,
        stdio: "pipe",
      });
      sessionId = randomUUID();
      const state: LocalRun = {
        child,
        chunks: [],
        size: 0,
        exited: false,
        exitCode: null,
        timer: setTimeout(() => child.kill(), 240_000),
      };
      state.timer.unref();
      localRuns.set(sessionId, state);
      child.stdout.on("data", (chunk: Buffer) => {
        state.size += chunk.length;
        if (state.size > 4_000_000) {
          child.kill();
          return;
        }
        state.chunks.push(Buffer.from(chunk));
      });
      // Never surface raw CLI stderr, which may contain account information.
      child.stderr.resume();
      child.on("close", (code) => {
        state.exited = true;
        state.exitCode = code ?? 1;
        clearTimeout(state.timer);
      });
      child.on("error", () => {
        state.exited = true;
        state.exitCode = 1;
        clearTimeout(state.timer);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
    } else {
      await ensureHostReady();
      // A resume restores the workspace disk from the Firecracker snapshot and
      // ignores this source entirely (see prepare_and_start), but the
      // orchestrator's create validation still requires exactly one repository
      // source and rejects a request with none ("provide exactly one repository
      // source"). Mirror the connect flow's placeholder so provisioning passes;
      // the 4h lifecycle matches the connect flow the deployed host accepts.
      const placeholder = "Claude runtime execution.\n";
      await provisionSandbox({
        workspaceId: reference.profileId,
        ephemeral: true,
        repositoryUrl: null,
        repositorySnapshot: {
          files: [
            {
              path: "README.md",
              mode: "100644",
              contentBase64: Buffer.from(placeholder).toString("base64"),
            },
          ],
          totalBytes: Buffer.byteLength(placeholder),
        },
        baseSha: "0".repeat(40),
        expiresAt: new Date(leaseUntil).toISOString(),
        resumeFromSnapshot: true,
        lifecycle: {
          timeoutMs: 4 * 60 * 60_000,
          lifecycle: { onTimeout: "pause", autoResume: true },
        },
      });
      const home = `/tmp/${reference.sessionId}`;
      // No workspace files, shared HOME, inherited API keys, or token injection.
      // Reuse the runtime's asynchronous execution/polling transport without a
      // Codex auth cache. Older guests reject this request rather than falling back.
      sessionId = await startCodexExecInSandbox(reference.profileId, {
        command: [
          "timeout",
          "--kill-after=5",
          "240",
          "env",
          "-i",
          "PATH=/usr/local/bin:/usr/bin:/bin",
          `HOME=${home}`,
          `CLAUDE_CONFIG_DIR=${home}/config`,
          "claude",
          ...args,
          prompt,
        ],
        idempotencyKey: requestId,
      });
    }
    run = {
      reference,
      connectionId: connection.id,
      userId,
      leaseUntil,
      sessionId,
    };
    return encode(run);
  } catch (error) {
    // The curated messages thrown below are all a caller ever sees; record the
    // real cause (redacted) so operators can tell a host cold-start/timeout from
    // an exec-transport rejection or a bad model alias.
    logStartFailure("start", reference.backend, error);
    if (run) await cleanupClaudeExecution(encode(run));
    else {
      if (reference.backend === "orchestrator") {
        try {
          await destroySandbox(reference.profileId);
        } catch (cleanupError) {
          logStartFailure("cleanup", reference.backend, cleanupError);
          throw new Error(
            "Claude runtime cleanup is pending. Wait for the execution lease to expire before retrying.",
          );
        }
      }
      await releaseClaudeSubscriptionExecution(connection.id, leaseUntil);
    }
    throw new Error(
      "Official Claude Code could not start. Verify your connection and runtime deployment.",
    );
  }
}

function logStartFailure(
  phase: "start" | "cleanup",
  backend: string,
  error: unknown,
) {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  logEvent("error", "claude_execution_start_failed", {
    phase,
    backend,
    status: typeof status === "number" ? status : undefined,
    detail: error instanceof Error ? error.message : String(error),
  });
}

export async function pollClaudeExecution(id: string, after: number) {
  const run = decode(id);
  const connection = await getConnectedClaudeRuntime(run.userId);
  if (
    connection?.id !== run.connectionId ||
    connection.expiresAt.getTime() !== run.leaseUntil ||
    Date.now() >= run.leaseUntil
  )
    throw new Error("Claude connection was revoked or execution expired.");
  if (run.reference.backend === "orchestrator") {
    const result = await pollCodexExecInSandbox(
      run.reference.profileId,
      run.sessionId,
      after,
    );
    return {
      chunks: result.chunks,
      exited: result.exited,
      exitCode: result.exitCode,
      nextSequence: result.nextSequence,
    };
  }
  const state = localRuns.get(run.sessionId);
  if (!state)
    throw new Error("Local Claude runtime restarted; retry the request.");
  if (!state.exited && after >= state.chunks.length)
    await new Promise((resolve) => setTimeout(resolve, 250));
  return {
    chunks: state.chunks.slice(after).map((data, index) => ({
      sequence: after + index + 1,
      dataBase64: data.toString("base64"),
    })),
    exited: state.exited,
    exitCode: state.exitCode,
    nextSequence: state.chunks.length,
  };
}

export async function cleanupClaudeExecution(id: string) {
  const run = decode(id);
  const current = await getConnectedClaudeRuntime(run.userId);
  if (
    current?.id === run.connectionId &&
    current.expiresAt.getTime() !== run.leaseUntil
  )
    return;
  // Do not release the lease if stopping/persisting fails: another request must
  // not race a still-running process. The bounded lease remains recoverable.
  if (run.reference.backend === "subprocess") {
    const state = localRuns.get(run.sessionId);
    if (state && !state.exited) {
      state.child.kill();
      const deadline = Date.now() + 5000;
      while (!state.exited && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 25));
      if (!state.exited) throw new Error("Claude is still stopping.");
    }
    clearTimeout(state?.timer);
    localRuns.delete(run.sessionId);
  } else {
    await closeCodexExecInSandbox(run.reference.profileId, run.sessionId);
    const connection = await getConnectedClaudeRuntime(run.userId);
    if (connection?.id === run.connectionId) {
      const sandbox = await getSandbox(run.reference.profileId);
      await snapshotWorkspace(run.reference.profileId, sandbox.headSha);
    }
    await destroySandbox(run.reference.profileId);
  }
  await releaseClaudeSubscriptionExecution(run.connectionId, run.leaseUntil);
}

export const claudeResultSchema = z.object({
  type: z.literal("result"),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
});
export function parseClaudeResult(output: string) {
  for (const line of output.trim().split(/\r?\n/).reverse()) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const result = claudeResultSchema.safeParse(value);
    if (!result.success) continue;
    if (result.data.is_error) break;
    return result.data;
  }
  throw new Error("Official Claude Code returned no successful result.");
}

export async function completeClaudeExecution(
  userId: string,
  model: string,
  prompt: string,
  outputSchema?: object,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const id = await startClaudeExecution(
    userId,
    model,
    prompt,
    randomUUID(),
    outputSchema,
  );
  try {
    let after = 0;
    const chunks: Buffer[] = [];
    let size = 0;
    const deadline = Date.now() + 260_000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const poll = await pollClaudeExecution(id, after);
      after = poll.nextSequence;
      for (const chunk of poll.chunks) {
        const data = Buffer.from(chunk.dataBase64, "base64");
        size += data.length;
        chunks.push(data);
      }
      if (size > 4_000_000) throw new Error("Claude output limit exceeded.");
      if (poll.exited) {
        if (poll.exitCode !== 0)
          throw new Error(
            "Official Claude Code failed. Check your subscription connection.",
          );
        return parseClaudeResult(Buffer.concat(chunks).toString("utf8"));
      }
    }
    throw new Error("Claude execution timed out.");
  } finally {
    await cleanupClaudeExecution(id);
  }
}
