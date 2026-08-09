import "server-only";

import {
  GetCommandInvocationCommand,
  SSMClient,
  SendCommandCommand,
} from "@aws-sdk/client-ssm";

import { getAwsConfiguration } from "./aws";
import { getGitHubUserToken } from "./github";
import { getHostInstanceId, getHostState, requestHostWake } from "./host";
import {
  buildCloneScript,
  orcaWorkspacePath,
  parseOrcaReady,
  type OrcaPairing,
} from "./orca-pairing";

/**
 * Control-plane client for the Orca runtime that runs on the CoDev EC2 host
 * (`orca-serve.service`). All host interaction goes through SSM RunCommand;
 * the browser only ever receives the pairing offer and connects directly to
 * the TLS WebSocket endpoint advertised by the runtime.
 */

const READY_FILE = "/home/orca/orca-ready.json";
const PAIRING_CACHE_TTL_MS = 60_000;

let cachedPairing: { pairing: OrcaPairing; fetchedAt: number } | null = null;

function createSsmClient(): SSMClient {
  const configuration = getAwsConfiguration();
  return new SSMClient({
    region: configuration.region,
    credentials: configuration.credentials,
  });
}

export class OrcaHostError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "OrcaHostError";
  }
}

async function runHostScript(
  script: string,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<string> {
  const client = createSsmClient();
  const instanceId = await getHostInstanceId();
  const sent = await client.send(
    new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: "AWS-RunShellScript",
      TimeoutSeconds: Math.max(30, Math.ceil(timeoutMs / 1000)),
      Parameters: { commands: [script] },
    }),
  );
  const commandId = sent.Command?.CommandId;
  if (!commandId) {
    throw new OrcaHostError("The host command could not be started.");
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    let invocation;
    try {
      invocation = await client.send(
        new GetCommandInvocationCommand({
          CommandId: commandId,
          InstanceId: instanceId,
        }),
      );
    } catch (error) {
      // The invocation is not immediately queryable after SendCommand.
      if ((error as Error).name === "InvocationDoesNotExist") {
        continue;
      }
      throw error;
    }
    const status = invocation.Status;
    if (status === "Success") {
      return invocation.StandardOutputContent ?? "";
    }
    if (
      status === "Failed" ||
      status === "Cancelled" ||
      status === "TimedOut"
    ) {
      throw new OrcaHostError(
        `The host command ${status.toLowerCase()}: ${
          invocation.StandardErrorContent?.slice(0, 500) || "no error output"
        }`,
      );
    }
    if (Date.now() > deadline) {
      throw new OrcaHostError("Timed out waiting for the host command.");
    }
  }
}

export type OrcaRuntimeState =
  | { state: "host-starting" }
  | { state: "ready"; pairing: OrcaPairing };

/**
 * Ensure the EC2 host is running and the Orca runtime has published a
 * pairing offer. Returns `host-starting` while the instance boots so the
 * client can poll.
 */
export async function ensureOrcaRuntime(): Promise<OrcaRuntimeState> {
  const hostState = await getHostState();
  if (hostState !== "running") {
    const wake = await requestHostWake();
    if (wake !== "running") {
      return { state: "host-starting" };
    }
  }

  if (
    cachedPairing &&
    Date.now() - cachedPairing.fetchedAt < PAIRING_CACHE_TTL_MS
  ) {
    return { state: "ready", pairing: cachedPairing.pairing };
  }

  const output = await runHostScript(
    [
      `systemctl is-active --quiet orca-serve.service || systemctl start orca-serve.service`,
      `for i in $(seq 1 40); do [ -f ${READY_FILE} ] && break; sleep 2; done`,
      `cat ${READY_FILE}`,
    ].join("\n"),
    { timeoutMs: 110_000 },
  );
  const readyLine = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("{"));
  if (!readyLine) {
    throw new OrcaHostError(
      "The Orca runtime did not publish a readiness file. Check orca-serve.service on the host.",
    );
  }
  const pairing = parseOrcaReady(readyLine);
  cachedPairing = { pairing, fetchedAt: Date.now() };
  return { state: "ready", pairing };
}

/**
 * Idempotently clone the workspace repository onto the Orca host so it can be
 * opened as an Orca project. Private repositories use the requesting user's
 * GitHub token for the initial clone only; the persisted remote is tokenless.
 */
export async function ensureOrcaWorkspaceClone(
  workspace: {
    id: string;
    repository: string | null;
    repositoryVisibility: string | null;
    defaultBranch: string | null;
  },
  userId: string,
): Promise<{ workspacePath: string | null }> {
  if (!workspace.repository || !workspace.defaultBranch) {
    return { workspacePath: null };
  }
  const token =
    workspace.repositoryVisibility === "private"
      ? await getGitHubUserToken(userId)
      : undefined;
  const script = buildCloneScript({
    workspaceId: workspace.id,
    repository: workspace.repository,
    defaultBranch: workspace.defaultBranch,
    token,
  });
  const output = await runHostScript(script, { timeoutMs: 180_000 });
  if (!output.includes("CLONE_OK")) {
    throw new OrcaHostError("The workspace repository clone did not complete.");
  }
  return { workspacePath: orcaWorkspacePath(workspace.id) };
}
