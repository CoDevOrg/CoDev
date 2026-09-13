import "server-only";

import {
  unavailableClaudeRunner,
  type ClaudeLoginRunner,
} from "./claude-connection-session";
import { subprocessClaudeRunner } from "./claude-subprocess-login";
import {
  decodeClaudeRuntimeReference,
  encodeClaudeRuntimeReference,
} from "./claude-runtime-reference";
import {
  destroySandbox,
  discardSandboxSnapshot,
  ensureHostReady,
  provisionSandbox,
  pollClaudeSetupTokenInSandbox,
  startClaudeSetupTokenInSandbox,
  submitClaudeSetupTokenCodeInSandbox,
  snapshotWorkspace,
  getSandbox,
  resumeSandbox,
} from "./orchestrator";

export { subprocessClaudeRunner };

export const orchestratorClaudeRunner: ClaudeLoginRunner = {
  async start({ sessionId }) {
    await ensureHostReady();
    try {
      await provisionSandbox({
        workspaceId: sessionId,
        // Abandoned attempts expire; verified profiles survive in VM snapshots.
        ephemeral: true,
        repositoryUrl: null,
        repositorySnapshot: {
          files: [
            {
              path: "README.md",
              mode: "100644",
              contentBase64: Buffer.from(
                "Private Claude login runtime.\n",
              ).toString("base64"),
            },
          ],
          totalBytes: Buffer.byteLength("Private Claude login runtime.\n"),
        },
        baseSha: "0".repeat(40),
        expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
        resumeFromSnapshot: false,
        lifecycle: {
          timeoutMs: 4 * 60 * 60000,
          lifecycle: { onTimeout: "pause", autoResume: true },
        },
      });
      const started = await startClaudeSetupTokenInSandbox(sessionId, {
        idempotencyKey: sessionId,
      });
      return {
        runnerId: encodeClaudeRuntimeReference({
          version: 1,
          backend: "orchestrator",
          profileId: sessionId,
          sessionId: started.sessionId,
        }),
        authorizeUrl: started.authorizeUrl,
      };
    } catch {
      await destroySandbox(sessionId).catch(() => {});
      await discardSandboxSnapshot(sessionId).catch(() => {});
      throw new Error(
        "Official Claude login could not start. The orchestrator and guest image must support the runtime-login protocol.",
      );
    }
  },
  async submitCode({ runnerId, code }) {
    const reference = decodeClaudeRuntimeReference(runnerId);
    if (reference.backend !== "orchestrator")
      throw new Error("Wrong runtime backend.");
    await submitClaudeSetupTokenCodeInSandbox(
      reference.profileId,
      reference.sessionId,
      code,
    );
  },
  async poll({ runnerId }) {
    const reference = decodeClaudeRuntimeReference(runnerId);
    if (reference.backend !== "orchestrator")
      throw new Error("Wrong runtime backend.");
    await ensureHostReady();
    const sandbox = await getSandbox(reference.profileId);
    if (sandbox.status === "hibernated")
      await resumeSandbox(reference.profileId);
    return pollClaudeSetupTokenInSandbox(
      reference.profileId,
      reference.sessionId,
    );
  },
  async retain({ runnerId }) {
    const reference = decodeClaudeRuntimeReference(runnerId);
    if (reference.backend !== "orchestrator")
      throw new Error("Wrong runtime backend.");
    const sandbox = await getSandbox(reference.profileId);
    await snapshotWorkspace(reference.profileId, sandbox.headSha);
    // Snapshot includes the private guest profile. Release live VM capacity.
    await destroySandbox(reference.profileId);
  },
  async dispose({ runnerId }) {
    const reference = decodeClaudeRuntimeReference(runnerId);
    if (reference.backend !== "orchestrator")
      throw new Error("Wrong runtime backend.");
    await destroySandbox(reference.profileId);
    await discardSandboxSnapshot(reference.profileId);
  },
};

export function resolveClaudeRunner(runnerId?: string): ClaudeLoginRunner {
  const backend = runnerId
    ? decodeClaudeRuntimeReference(runnerId).backend
    : process.env.CLAUDE_CONNECTION_RUNNER;
  if (backend === "subprocess") {
    if (process.env.VERCEL)
      throw new Error(
        "Subprocess Claude login requires a persistent local runtime, not Vercel.",
      );
    return subprocessClaudeRunner;
  }
  if (backend === "orchestrator") return orchestratorClaudeRunner;
  return unavailableClaudeRunner;
}

/**
 * Whether the runner for a stored reference can run in this environment.
 * A `subprocess` profile lives on the persistent local host that created it, so
 * from Vercel serverless it can be neither executed nor disposed. Disconnect and
 * reaping use this to clear such a stranded record instead of resolving a runner
 * that would throw. Unknown/legacy references are not disposable here either.
 */
export function isClaudeRunnerDisposableHere(runnerId: string): boolean {
  let backend: string;
  try {
    backend = decodeClaudeRuntimeReference(runnerId).backend;
  } catch {
    return false;
  }
  if (backend === "subprocess") return !process.env.VERCEL;
  return true;
}

export function isHostedClaudeConnectEnabled() {
  if (
    process.env.VERCEL &&
    process.env.CLAUDE_CONNECTION_RUNNER === "subprocess"
  )
    return false;
  return resolveClaudeRunner() !== unavailableClaudeRunner;
}
