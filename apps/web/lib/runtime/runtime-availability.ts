import { OrchestratorError } from "./orchestrator";

/**
 * Tells a runtime that is *booting* apart from one that is *not coming*.
 *
 * `ensureOrcaSession` used to answer "host-starting" for every failure on the
 * way to a session — a stopped VM, a cold orchestrator, a dropped request, but
 * equally a missing subscription id, an expired `az login`, or a host that does
 * not exist in the resource group. The client treats "starting" as a 202 that
 * clears any recorded failure, so those permanent conditions polled forever and
 * settled on "this is taking longer than usual — it will open on its own".
 *
 * It never opened. Locally that is the normal experience, because an
 * unconfigured checkout hits exactly these errors on the first request.
 *
 * Anything this function does not recognise stays transient: an unknown fault
 * that resolves itself is a worse thing to turn into a dead end than an unknown
 * fault that polls a few more times.
 */

/** Azure identity failures: no `az login`, an expired session, or a federated
 *  exchange that cannot complete. None of these fix themselves by waiting. */
const CREDENTIAL_ERROR_NAMES = new Set([
  "CredentialUnavailableError",
  "AuthenticationError",
  "AggregateAuthenticationError",
  "AuthenticationRequiredError",
]);

/**
 * Thrown by `getAzureSubscriptionId`, `getAzureResourceGroup` and
 * `orchestratorDirectRequest` when their variables are absent, and by both
 * `resolveHost` implementations when no VM carries the stack's tags. Matched on
 * message because they are plain `Error`s raised at the point of use, where a
 * dedicated class would buy nothing else.
 */
const CONFIGURATION_MESSAGES = [
  /is not configured\.?$/i,
  /are not configured\.?$/i,
  /Firecracker host was not found/i,
];

/** Authorization, not availability: the caller may never do this. */
const FATAL_ORCHESTRATOR_STATUSES = new Set([401, 403]);

/**
 * What someone opening a workspace is told, on any deployed build.
 *
 * Every `detail` below names infrastructure — environment variables, the cloud
 * provider, `az login` — which is operator information, not member
 * information. On staging or production it would tell whoever hit the error
 * (including anyone who should not be looking) how CoDev is wired, while
 * giving them nothing they could act on. They get this instead; the detail
 * goes to the server log, where the people who can fix it are looking.
 */
export const RUNTIME_UNAVAILABLE_MESSAGE =
  "This workspace's runtime is unavailable right now. The details have been logged for the CoDev team.";

/**
 * A runtime that cannot be reached, in two registers: `detail` for logs and
 * local development, `message` for anyone else.
 */
export type RuntimeUnavailable = { detail: string; message: string };

function unavailable(detail: string): RuntimeUnavailable {
  return { detail, message: RUNTIME_UNAVAILABLE_MESSAGE };
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

/**
 * Why the runtime cannot be reached at all, or `null` when the failure is
 * worth polling through.
 *
 * `detail` names the condition precisely, for a log line and for a developer
 * running locally. It is never what a member on a deployed build is shown —
 * see `RUNTIME_UNAVAILABLE_MESSAGE`.
 */
export function classifyRuntimeFailure(
  error: unknown,
): RuntimeUnavailable | null {
  if (error instanceof OrchestratorError) {
    return FATAL_ORCHESTRATOR_STATUSES.has(error.status)
      ? unavailable(
          `The orchestrator refused the request (${error.status}). Check the orchestrator credentials for this environment.`,
        )
      : null;
  }

  const name = errorName(error);
  if (name && CREDENTIAL_ERROR_NAMES.has(name)) {
    return unavailable(
      "Could not authenticate to the workspace runtime. Sign in with `az login`, or check this environment's Azure credentials.",
    );
  }

  const message = error instanceof Error ? error.message : "";
  if (CONFIGURATION_MESSAGES.some((pattern) => pattern.test(message))) {
    return unavailable(
      `This environment cannot reach a workspace runtime: ${message}`,
    );
  }

  return null;
}
