import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  createSupersetWorktree,
  listSupersetWorktrees,
} from "../runtime/orchestrator-superset-runtime";
import {
  describeSeatHolder,
  heartbeatCredentialSeat,
  releaseCredentialSeat,
  waitForCredentialSeat,
} from "../providers/credential-seat";
import {
  appendGen2ChatMessage,
  listGen2ChatMessages,
  requireGen2Chat,
} from "./chats";
import { buildGen2AgentCommand } from "./agent-command";
import { Gen2LifecycleError } from "./errors";
import { logEvent } from "../platform/observability";
import { resolveGen2Credential, type Gen2AgentProvider } from "./providers";
import { providerVendor } from "../providers/registry";
import { updateHostedCodexAuthCacheIfCurrent } from "../providers/hosted-codex-subscription-credentials";
import { updateCursorAuthCache } from "../providers/cursor-auth-refresh";
import {
  captureSupersetAgentCredential,
  checkSupersetAgentRecovery,
  pollSupersetAgent,
  sendSupersetAgentInput,
  startSupersetAgent,
  stopSupersetAgent,
} from "./superset-agent-orchestrator-client";
import { isGen2AgentCoordinationEnabled } from "./agent-coordination-feature";
import { isGen2SupersetAgentSessionsEnabled } from "./superset-agent-sessions-feature";
import {
  claimGen2SupersetRunLease,
  getGen2SupersetRunById,
  getActiveGen2SupersetRunForSession,
  listMonitorableGen2SupersetRuns,
  listCheckpointableGen2SupersetRuns,
  markGen2SupersetRunFailed,
  markGen2SupersetRunFinished,
  markGen2SupersetRunRecoveryRequired,
  markGen2SupersetRunStarted,
  markGen2SupersetRunStopping,
  registerGen2SupersetRun,
  releaseGen2SupersetRunLease,
} from "./superset-runs";
import { createGen2Turn, recordGen2SupersetRunOutput } from "./turns";
import { toAgentExecChunks } from "./agent-output";
import { requireWorkspaceOwnerPlan } from "../billing/gate";
import { requireGen2Member } from "./workspaces";
import { requireGen2SupersetAgentAccess } from "./superset-agent-access";
import {
  createGen2AgentSession,
  getGen2AgentSession,
  updateGen2AgentSessionStatus,
} from "./agent-sessions";

/**
 * The server-only CoDev runtime adapter docs/SUPERSET_AGENT_SESSION_PLAN.md
 * Phase 3 calls for: it wires Phase 1's durable run state machine
 * (`superset-runs.ts`) to the orchestrator client Phase 3 also adds
 * (`superset-agent-orchestrator-client.ts`). `startGen2SupersetAgentTurn`,
 * `pollGen2SupersetAgentTurn`, and `cancelGen2SupersetAgentTurn` below are
 * Phase 4: the flag-gated delegate `agent.ts`'s unchanged
 * `startGen2AgentTurn`/`pollGen2AgentTurn`/`cancelGen2AgentTurn` browser
 * contract calls into instead of the direct `codex exec` sandbox path.
 */

function requireEnabled() {
  if (!isGen2SupersetAgentSessionsEnabled()) {
    throw new Gen2LifecycleError(
      "Superset agent sessions are not enabled.",
      404,
    );
  }
}

async function requireOwnRun(workspaceId: string, runId: string) {
  const run = await getGen2SupersetRunById(runId);
  if (!run || run.workspaceId !== workspaceId) {
    throw new Gen2LifecycleError("Superset run not found.", 404);
  }
  return run;
}

async function requireTurnRun(
  workspaceId: string,
  userId: string,
  runId: string,
) {
  await requireGen2Member(workspaceId, userId);
  return requireOwnRun(workspaceId, runId);
}

type StartSessionInput = {
  sessionId?: string | null;
  workspaceId: string;
  userId: string;
  chatId?: string | null;
  worktreeId: string;
  command: string[];
  idempotencyKey: string;
  provider: Gen2AgentProvider;
  /** The caller already checked membership, the chat and the owner's plan. */
  verified?: boolean;
};

export async function startGen2SupersetAgentSession(input: StartSessionInput) {
  return startSession(input, "persistent");
}

async function startSession(
  input: StartSessionInput,
  mode: "persistent" | "turn",
) {
  requireEnabled();
  if (mode === "persistent") {
    await requireGen2SupersetAgentAccess({
      action: "start",
      workspaceId: input.workspaceId,
      userId: input.userId,
    });
  } else if (!input.verified) {
    await requireGen2Member(input.workspaceId, input.userId);
  }
  // Each database trip crosses the country, so the plan check (a dozen of
  // them) runs once per turn; a verified caller has already run it.
  if (!input.verified) await requireWorkspaceOwnerPlan(input.workspaceId);
  const provider = input.provider;
  const credential = await resolveGen2Credential(input.userId, provider);

  const registration = await registerGen2SupersetRun({
    sessionId: input.sessionId ?? null,
    workspaceId: input.workspaceId,
    chatId: input.chatId ?? null,
    createdBy: input.userId,
    worktreeId: input.worktreeId,
    provider: providerVendor(provider),
    connectionId: credential.credentialId,
    credentialRevision: credential.credentialRevision,
    idempotencyKey: input.idempotencyKey,
  });
  if (!registration.created) {
    // A retried start reattaches to the run already in flight instead of
    // claiming a second lease or starting a second Superset process.
    return registration;
  }

  // Only a subscription holds a seat -- an API key has no one-turn-at-a-time
  // limit, so claiming one would invent a restriction the provider does not.
  //
  // A busy seat used to be swallowed here and the run started anyway. It now
  // waits, and fails the run with what holds the seat if the wait runs out,
  // so the member is told the truth instead of two turns sharing one login.
  const claimed = Boolean(credential.credentialId);
  if (credential.credentialId) {
    const seat = await waitForCredentialSeat({
      credentialId: credential.credentialId,
      userId: input.userId,
      surface: "gen2",
      ref: registration.runId,
    });
    if (!seat.held) {
      await markGen2SupersetRunFailed({
        runId: registration.runId,
        workspaceId: input.workspaceId,
        lastError: "credential_busy",
        actorId: input.userId,
      });
      throw new Gen2LifecycleError(describeSeatHolder(seat.holder), 409);
    }
    await claimGen2SupersetRunLease({
      runId: registration.runId,
      workspaceId: input.workspaceId,
      actorId: input.userId,
    });
  }

  try {
    const started = await startSupersetAgent(input.workspaceId, {
      codevRunId: registration.runId,
      codevWorkspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
      provider: providerVendor(provider),
      launchProfile: credential.launchProfile,
      command: input.command,
      idempotencyKey: input.idempotencyKey,
      ...(isGen2AgentCoordinationEnabled(input.workspaceId)
        ? { coordination: true }
        : {}),
    });
    await Promise.all([
      markGen2SupersetRunStarted({
        runId: registration.runId,
        workspaceId: input.workspaceId,
        hostWorkspaceId: started.hostWorkspaceId,
        hostTerminalId: started.hostTerminalId,
        hostAgentSessionId: started.hostAgentSessionId,
        actorId: input.userId,
      }),
      input.sessionId
        ? updateGen2AgentSessionStatus({
            sessionId: input.sessionId,
            status: "running",
            recoveryState: "not_required",
          })
        : null,
    ]);
    return { ...registration, status: "running" as const };
  } catch (error) {
    if (claimed && credential.credentialId) {
      await releaseCredentialSeat({
        credentialId: credential.credentialId,
        ref: registration.runId,
      });
      await releaseGen2SupersetRunLease({
        runId: registration.runId,
        workspaceId: input.workspaceId,
        actorId: input.userId,
      });
    }
    await markGen2SupersetRunFailed({
      runId: registration.runId,
      workspaceId: input.workspaceId,
      lastError: error instanceof Error ? error.message : "unknown",
      actorId: input.userId,
    });
    if (input.sessionId) {
      await updateGen2AgentSessionStatus({
        sessionId: input.sessionId,
        status: "failed",
      });
    }
    throw error;
  }
}

export async function sendGen2SupersetAgentInput(input: {
  workspaceId: string;
  userId: string;
  runId: string;
  data: string;
}) {
  requireEnabled();
  const run = await requireGen2SupersetAgentAccess({
    action: "input",
    workspaceId: input.workspaceId,
    userId: input.userId,
    runId: input.runId,
  });
  await requireWorkspaceOwnerPlan(input.workspaceId);
  if (!run.hostAgentSessionId) {
    throw new Gen2LifecycleError("This run has not started yet.", 409);
  }
  await sendSupersetAgentInput(
    input.workspaceId,
    run.hostAgentSessionId,
    input.data,
  );
}

/** Send a follow-up to the current process for one durable logical session. */
export async function sendGen2AgentSessionFollowUp(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
  data: string;
}) {
  const run = await getActiveGen2SupersetRunForSession(input.sessionId);
  if (!run || run.workspaceId !== input.workspaceId) {
    throw new Gen2LifecycleError("Agent session is not running.", 409);
  }
  await sendGen2SupersetAgentInput({ ...input, runId: run.id });
}

type PollSessionInput = {
  workspaceId: string;
  userId: string;
  runId: string;
  after: number;
};

type SupersetRun = NonNullable<
  Awaited<ReturnType<typeof getGen2SupersetRunById>>
>;

async function persistSupersetAgentCredential(
  run: SupersetRun,
  workspaceId: string,
) {
  if (run.provider === "cursor" && run.hostAgentSessionId) {
    const { authCacheJson } = await captureSupersetAgentCredential(
      workspaceId,
      run.hostAgentSessionId,
    );
    // Like a native turn, a refreshed Cursor login returns to its creator.
    if (authCacheJson)
      await updateCursorAuthCache(run.createdBy, authCacheJson);
    return;
  }
  if (
    run.provider !== "openai" ||
    !run.connectionId ||
    !run.credentialRevision ||
    !run.hostAgentSessionId
  ) {
    return;
  }
  const { authCacheJson } = await captureSupersetAgentCredential(
    workspaceId,
    run.hostAgentSessionId,
  );
  if (authCacheJson) {
    await updateHostedCodexAuthCacheIfCurrent(
      run.connectionId,
      run.credentialRevision,
      authCacheJson,
    );
  }
}

export async function pollGen2SupersetAgentSession(input: PollSessionInput) {
  return pollSession(input, "persistent");
}

async function pollSession(
  input: PollSessionInput,
  mode: "persistent" | "turn",
) {
  requireEnabled();
  const run =
    mode === "persistent"
      ? await requireGen2SupersetAgentAccess({
          action: "poll",
          workspaceId: input.workspaceId,
          userId: input.userId,
          runId: input.runId,
        })
      : await requireTurnRun(input.workspaceId, input.userId, input.runId);
  if (!run.hostAgentSessionId) {
    throw new Gen2LifecycleError("This run has not started yet.", 409);
  }

  const result = await pollSupersetAgent(
    input.workspaceId,
    run.hostAgentSessionId,
    input.after,
  );

  // Save output before refreshing credentials: account recovery must not hide a reply.
  const persisted =
    mode === "turn"
      ? await recordGen2SupersetRunOutput({
          sessionId: input.runId,
          chunks: result.chunks,
          exited: result.exited,
          exitCode: result.exitCode,
        })
      : null;

  // Being polled is what holding the seat means; a run that stops polling
  // stops blocking the member's other surfaces.
  if (run.leaseClaimed && run.connectionId && !result.exited) {
    await heartbeatCredentialSeat({
      credentialId: run.connectionId,
      ref: run.id,
    });
  }

  if (result.exited) {
    try {
      if (result.refreshReady) {
        await persistSupersetAgentCredential(run, input.workspaceId);
      }
    } catch {
      await markGen2SupersetRunRecoveryRequired({
        runId: run.id,
        workspaceId: input.workspaceId,
        lastError: "Could not save refreshed provider credentials.",
        actorId: input.userId,
      });
      logEvent("error", "gen2.superset_agent.credential_refresh_failed", {
        runId: run.id,
      });
      return {
        ...result,
        persisted,
        error:
          "Codex finished and your reply was saved, but sign-in refresh failed. This workspace needs an agent runtime update before the next turn.",
      };
    }
    await markGen2SupersetRunFinished({
      runId: run.id,
      workspaceId: input.workspaceId,
      exitReason:
        result.exitCode === 0 ? "completed" : `exit_code:${result.exitCode}`,
      actorId: input.userId,
    });
    if (run.sessionId) {
      await updateGen2AgentSessionStatus({
        sessionId: run.sessionId,
        status: result.exitCode === 0 ? "completed" : "failed",
      });
    }
    if (run.leaseClaimed && run.connectionId) {
      await releaseCredentialSeat({
        credentialId: run.connectionId,
        ref: run.id,
      });
    }
    await releaseGen2SupersetRunLease({
      runId: run.id,
      workspaceId: input.workspaceId,
      actorId: input.userId,
    });
    await stopSupersetAgent(input.workspaceId, run.hostAgentSessionId).catch(
      (error) =>
        logEvent("warn", "gen2.superset_agent.profile_cleanup_failed", {
          detail: error instanceof Error ? error.message : "unknown",
          runId: run.id,
        }),
    );
  }

  return { ...result, persisted, error: undefined };
}

type CancelSessionInput = {
  workspaceId: string;
  userId: string;
  runId: string;
};

export async function cancelGen2SupersetAgentSession(
  input: CancelSessionInput,
) {
  return cancelSession(input, "persistent");
}

/** Stop the current process for one durable logical session. */
export async function stopGen2AgentSession(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
}) {
  const run = await getActiveGen2SupersetRunForSession(input.sessionId);
  if (!run || run.workspaceId !== input.workspaceId) {
    throw new Gen2LifecycleError("Agent session is not running.", 409);
  }
  await cancelGen2SupersetAgentSession({ ...input, runId: run.id });
}

/** Start a fresh process for a stopped or recovery-required logical session. */
export async function restartGen2AgentSession(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
}) {
  requireEnabled();
  const [member, session] = await Promise.all([
    requireGen2Member(input.workspaceId, input.userId),
    getGen2AgentSession(input.workspaceId, input.sessionId),
  ]);
  if (
    member.role === "viewer" ||
    (member.role !== "owner" && session.createdBy !== input.userId)
  ) {
    throw new Gen2LifecycleError("Agent session not found.", 404);
  }
  if (!session.chatId) {
    throw new Gen2LifecycleError(
      "This agent session has no chat history.",
      409,
    );
  }
  const active = await getActiveGen2SupersetRunForSession(session.id);
  if (active)
    throw new Gen2LifecycleError("Agent session is already running.", 409);

  const provider =
    session.provider === "openai"
      ? "codex"
      : session.provider === "anthropic"
        ? "claude"
        : session.provider === "cursor"
          ? "cursor"
          : null;
  if (!provider) {
    throw new Gen2LifecycleError(
      "This agent provider cannot be restarted.",
      409,
    );
  }
  await requireGen2Chat(input.workspaceId, session.chatId);
  const history = await listGen2ChatMessages(session.chatId);
  await updateGen2AgentSessionStatus({
    sessionId: session.id,
    status: "queued",
    recoveryState: "restarting",
  });
  const restarted = await startSession(
    {
      sessionId: session.id,
      workspaceId: input.workspaceId,
      userId: input.userId,
      chatId: session.chatId,
      worktreeId: session.worktreeId,
      command: buildGen2AgentCommand(provider, session.task, history),
      provider,
      idempotencyKey: `restart:${session.id}:${randomUUID()}`,
    },
    "persistent",
  );
  return { runId: restarted.runId };
}

async function cancelSession(
  input: CancelSessionInput,
  mode: "persistent" | "turn",
) {
  requireEnabled();
  const run =
    mode === "persistent"
      ? await requireGen2SupersetAgentAccess({
          action: "cancel",
          workspaceId: input.workspaceId,
          userId: input.userId,
          runId: input.runId,
        })
      : await requireTurnRun(input.workspaceId, input.userId, input.runId);

  await markGen2SupersetRunStopping({
    runId: run.id,
    workspaceId: input.workspaceId,
    actorId: input.userId,
  });
  try {
    if (run.hostAgentSessionId) {
      await persistSupersetAgentCredential(run, input.workspaceId);
      await stopSupersetAgent(input.workspaceId, run.hostAgentSessionId);
    }
  } catch (error) {
    await markGen2SupersetRunRecoveryRequired({
      runId: run.id,
      workspaceId: input.workspaceId,
      lastError: "Could not save refreshed provider credentials.",
      actorId: input.userId,
    });
    throw error;
  }
  if (run.leaseClaimed && run.connectionId) {
    await releaseCredentialSeat({
      credentialId: run.connectionId,
      ref: run.id,
    });
  }
  await releaseGen2SupersetRunLease({
    runId: run.id,
    workspaceId: input.workspaceId,
    actorId: input.userId,
  });
  await markGen2SupersetRunFinished({
    runId: run.id,
    workspaceId: input.workspaceId,
    exitReason: "cancelled",
    actorId: input.userId,
  });
  if (run.sessionId) {
    await updateGen2AgentSessionStatus({
      sessionId: run.sessionId,
      status: "stopped",
    });
  }
}

/**
 * Phase 5's host-restart reconciliation, exposed here since Phase 3 already
 * adds the `/agents/:id/recovery` route this calls. A run that cannot be
 * verified live moves to `recovery_required` rather than being silently
 * relaunched with a potentially stale credential profile.
 */
export async function reconcileGen2SupersetAgentSession(input: {
  workspaceId: string;
  userId: string;
  runId: string;
}) {
  requireEnabled();
  const run = await requireGen2SupersetAgentAccess({
    action: "recover",
    workspaceId: input.workspaceId,
    userId: input.userId,
    runId: input.runId,
  });
  if (!run.hostAgentSessionId) {
    return { adoptable: false as const };
  }

  const recovery = await checkSupersetAgentRecovery(
    input.workspaceId,
    run.hostAgentSessionId,
  );
  if (!recovery.adoptable) {
    await markGen2SupersetRunRecoveryRequired({
      runId: run.id,
      workspaceId: input.workspaceId,
      lastError:
        recovery.status === "exited"
          ? "Agent process exited while host was unreachable."
          : "Host could not verify the run after a restart.",
      actorId: input.userId,
    });
    if (run.sessionId) {
      await updateGen2AgentSessionStatus({
        sessionId: run.sessionId,
        status: "recovery_required",
        recoveryState: "required",
      });
    }
  } else {
    // If adoptable and actively running, ensure the credential seat lease is renewed
    if (run.leaseClaimed && run.connectionId) {
      await heartbeatCredentialSeat({
        credentialId: run.connectionId,
        ref: run.id,
      });
    }
  }
  return recovery;
}

/**
 * Server-owned liveness reconciliation. Browser polls can display progress,
 * but they must not be required to retain a credential seat or discover that
 * a guest was lost.
 */
export async function monitorGen2SupersetAgentSessions() {
  const runs = await listMonitorableGen2SupersetRuns();
  let running = 0;
  let recoveryRequired = 0;
  await Promise.all(
    runs.map(async (run) => {
      const recover = async (lastError: string) => {
        await markGen2SupersetRunRecoveryRequired({
          runId: run.id,
          workspaceId: run.workspaceId,
          lastError,
        });
        if (run.leaseClaimed && run.connectionId) {
          await releaseCredentialSeat({
            credentialId: run.connectionId,
            ref: run.id,
          });
        }
        await releaseGen2SupersetRunLease({
          runId: run.id,
          workspaceId: run.workspaceId,
        });
        recoveryRequired += 1;
      };
      if (!run.hostAgentSessionId) {
        await recover("Agent start was not confirmed by the guest.");
        return;
      }
      try {
        const recovery = await checkSupersetAgentRecovery(
          run.workspaceId,
          run.hostAgentSessionId,
        );
        if (!recovery.adoptable) {
          await recover("Guest could not verify the agent process.");
          return;
        }
        if (run.leaseClaimed && run.connectionId) {
          await heartbeatCredentialSeat({
            credentialId: run.connectionId,
            ref: run.id,
          });
        }
        running += 1;
      } catch {
        await recover("Guest liveness check failed.");
      }
    }),
  );
  return { checked: runs.length, running, recoveryRequired };
}

/** Called by the ARM lifecycle before it flushes and destroys a guest VM. */
export async function checkpointGen2SupersetAgentCredentials(
  workspaceId: string,
) {
  const runs = await listCheckpointableGen2SupersetRuns(workspaceId);
  for (const run of runs) {
    if (!run.hostAgentSessionId) continue;
    await persistSupersetAgentCredential(run, workspaceId);
  }
  return { checkpointed: runs.length };
}

/**
 * One worktree per start idempotency key. A retry gets the same checkout;
 * independent agents in the same chat get different checkouts.
 */
function agentWorktreeIdForStart(idempotencyKey: string) {
  return `agent-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40)}`;
}

async function ensureGen2SupersetAgentWorktree(
  workspaceId: string,
  idempotencyKey: string,
) {
  const worktreeId = agentWorktreeIdForStart(idempotencyKey);
  const existing = await listSupersetWorktrees(workspaceId);
  if (existing.some((worktree) => worktree.worktreeId === worktreeId)) {
    return worktreeId;
  }
  try {
    await createSupersetWorktree(workspaceId, {
      worktreeId,
      branch: `codev/${worktreeId}`,
      baseRef: "HEAD",
    });
  } catch (error) {
    // Two retries racing to create the same agent worktree: the loser's
    // `git worktree add` fails, but the worktree it wanted now exists anyway.
    const retried = await listSupersetWorktrees(workspaceId);
    if (!retried.some((worktree) => worktree.worktreeId === worktreeId)) {
      throw error;
    }
  }
  return worktreeId;
}

/**
 * Phase 4: what `startGen2AgentTurn` in `agent.ts` delegates to when
 * `CODEV_SUPERSET_AGENT_SESSIONS_ENABLED` is set, in place of
 * `startCodexExecInSandbox`. Same browser contract (`{ sessionId }`) -- the
 * durable run's own id stands in for the sandbox session id the direct path
 * returns, and `pollGen2SupersetAgentTurn`/`cancelGen2SupersetAgentTurn`
 * accept it back the same way.
 */
export async function startGen2SupersetAgentTurn(input: {
  workspaceId: string;
  userId: string;
  chatId: string;
  prompt: string;
  idempotencyKey: string;
  provider: Gen2AgentProvider;
  worktreeId?: string | undefined;
  model?: string | undefined;
  /** `startGen2AgentTurn` already checked membership, the chat and the plan. */
  verified?: boolean;
}) {
  requireEnabled();
  if (!input.verified) {
    await requireGen2Member(input.workspaceId, input.userId);
    await Promise.all([
      requireWorkspaceOwnerPlan(input.workspaceId),
      requireGen2Chat(input.workspaceId, input.chatId),
    ]);
  }
  const [history, worktreeId] = await Promise.all([
    listGen2ChatMessages(input.chatId),
    input.worktreeId ??
      ensureGen2SupersetAgentWorktree(input.workspaceId, input.idempotencyKey),
  ]);
  const provider = input.provider;
  const command = buildGen2AgentCommand(
    provider,
    input.prompt,
    history,
    input.model,
  );

  const logicalSession = await createGen2AgentSession({
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    createdBy: input.userId,
    task: input.prompt,
    worktreeId,
    provider: providerVendor(provider),
    idempotencyKey: input.idempotencyKey,
  });
  const session = await startSession(
    {
      sessionId: logicalSession.id,
      workspaceId: input.workspaceId,
      userId: input.userId,
      chatId: input.chatId,
      worktreeId,
      command,
      provider,
      idempotencyKey: input.idempotencyKey,
      verified: true,
    },
    "turn",
  );

  await Promise.all([
    (async () => {
      try {
        await appendGen2ChatMessage({
          chatId: input.chatId,
          role: "user",
          body: input.prompt,
        });
      } catch (error) {
        logEvent("error", "gen2.agent.persist_user_failed", {
          detail: error instanceof Error ? error.message : "unknown",
        });
      }
    })(),
    // From here the server owns the transcript: every poll appends to this
    // row, so the reply survives the browser going away mid-turn. Matches
    // `startGen2AgentTurn`'s `createGen2Turn` call in agent.ts; safe to repeat
    // on a retried start because of `onConflictDoNothing`.
    createGen2Turn({
      sessionId: session.runId,
      provider,
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      userId: input.userId,
    }),
  ]);
  return { sessionId: session.runId, agentSessionId: logicalSession.id };
}

/** Creates a logical session and its first Superset process in one request. */
export async function createGen2AgentSessionTask(input: {
  workspaceId: string;
  userId: string;
  chatId: string;
  task: string;
  idempotencyKey: string;
  provider: Gen2AgentProvider;
  worktreeId?: string | undefined;
  model?: string | undefined;
}) {
  const started = await startGen2SupersetAgentTurn({
    ...input,
    prompt: input.task,
  });
  return { sessionId: started.agentSessionId, runId: started.sessionId };
}

/**
 * Phase 4: `pollGen2AgentTurn`'s Superset delegate. `input.sessionId` is the
 * durable run id `startGen2SupersetAgentTurn` returned.
 */
export async function pollGen2SupersetAgentTurn(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
  after: number;
}) {
  requireEnabled();
  const result = await pollSession(
    {
      workspaceId: input.workspaceId,
      userId: input.userId,
      runId: input.sessionId,
      after: input.after,
    },
    "turn",
  );

  const persisted = result.persisted;

  return {
    chunks: toAgentExecChunks(result.chunks),
    nextSequence: result.nextSequence,
    exited: result.exited,
    exitCode: result.exitCode,
    reply: persisted?.reply ?? null,
    persistedMessageId: persisted?.messageId ?? null,
    ...(result.error ? { error: result.error } : {}),
  };
}

/**
 * Phase 4: `cancelGen2AgentTurn`'s Superset delegate.
 */
export async function cancelGen2SupersetAgentTurn(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
}) {
  requireEnabled();
  await cancelSession(
    {
      workspaceId: input.workspaceId,
      userId: input.userId,
      runId: input.sessionId,
    },
    "turn",
  );
}
