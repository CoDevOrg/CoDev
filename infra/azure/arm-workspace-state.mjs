import { randomUUID } from "node:crypto";

const phases = new Set([
  "stopped",
  "queued",
  "provisioning",
  "booting",
  "attaching_disk",
  "starting_tunnel",
  "checking_readiness",
  "ready",
  "stopping",
  "failed",
]);

function beginStart(state, key, now) {
  if (!key || key.length > 128) throw new Error("INVALID_IDEMPOTENCY_KEY");
  if (!["stopped", "failed"].includes(state.status))
    throw new Error("WORKSPACE_OPERATION_CONFLICT");
  if (state.retryAt && state.retryAt > now) throw new Error("RETRY_BACKOFF");
  if (state.errorTerminal) throw new Error("WORKSPACE_TERMINAL_FAILURE");
  return {
    ...state,
    status: "queued",
    generation: state.generation + 1,
    vmId: null,
    tunnelId: null,
    routeHost: null,
    operation: {
      id: randomUUID(),
      key,
      kind: "start",
      startedAt: now,
      leaseUntil: now + 90_000,
      attempts: state.failureAttempts ?? 0,
    },
    errorCode: null,
    retryAt: null,
  };
}

function beginStop(state, key, now) {
  if (!key || key.length > 128) throw new Error("INVALID_IDEMPOTENCY_KEY");
  if (state.operation?.key === key) return state;
  if (state.status === "stopped") return state;
  if (state.status === "stopping")
    throw new Error("WORKSPACE_OPERATION_CONFLICT");
  return {
    ...state,
    status: "stopping",
    generation: state.generation + 1,
    flushRequired: state.status === "ready",
    operation: {
      id: randomUUID(),
      key,
      kind: "stop",
      startedAt: now,
      leaseUntil: now + 90_000,
      attempts: state.failureAttempts ?? 0,
    },
  };
}

function advance(state, operationId, generation, changes, now) {
  if (state.operation?.id !== operationId || state.generation !== generation)
    throw new Error("STALE_OPERATION");
  if (!phases.has(changes.status)) throw new Error("INVALID_LIFECYCLE_STATE");
  return {
    ...state,
    ...changes,
    operation: state.operation && {
      ...state.operation,
      leaseUntil: now + 90_000,
    },
  };
}

function shouldStopForIdle(state, now) {
  return (
    state.status === "ready" &&
    !state.agentRunning &&
    Number.isSafeInteger(state.lastMemberInputAt) &&
    now - Math.max(state.lastMemberInputAt, state.lastAgentActiveAt ?? 0) >=
      15 * 60_000
  );
}

function recordMemberInput(state, at) {
  if (state.status !== "ready") return state;
  return {
    ...state,
    lastMemberInputAt: Math.max(state.lastMemberInputAt ?? 0, at),
  };
}

function classifyAzureFailure(code) {
  if (["SkuNotAvailable", "ZonalAllocationFailed"].includes(code))
    return { retryable: false, safeCode: "SKU_UNAVAILABLE" };
  if (code === "QuotaExceeded")
    return { retryable: false, safeCode: "QUOTA_EXCEEDED" };
  if (["DiskNotFound", "ResourceNotFound"].includes(code))
    return { retryable: false, safeCode: "DISK_MISSING" };
  if (["DiskNotReady", "DiskAlreadyInUse", "DiskInUse"].includes(code))
    return { retryable: true, safeCode: "DISK_ATTACH_CONFLICT" };
  if (
    [
      "Conflict",
      "OperationNotAllowed",
      "TooManyRequests",
      "RetryableError",
      "ServiceUnavailable",
      "InternalServerError",
      "GatewayTimeout",
      "AllocationFailed",
      "OverconstrainedAllocationRequest",
    ].includes(code)
  )
    return { retryable: true, safeCode: "ALLOCATION_FAILED" };
  if (code === "READINESS_TIMEOUT")
    return { retryable: true, safeCode: "READINESS_TIMEOUT" };
  if (code === "TUNNEL_FAILED")
    return { retryable: true, safeCode: "TUNNEL_FAILED" };
  return { retryable: false, safeCode: "ALLOCATION_FAILED" };
}

function nextRetry(attempt, now) {
  if (attempt >= 6) return null;
  return now + Math.min(30_000, 1000 * 2 ** attempt);
}

export const lifecycleState = {
  beginStart,
  beginStop,
  advance,
  shouldStopForIdle,
  recordMemberInput,
  classifyAzureFailure,
  nextRetry,
};
