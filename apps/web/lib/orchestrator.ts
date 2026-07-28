import "server-only";

import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { readServerEnvironment } from "@codev/config";
import { sandboxInstanceSchema, type SandboxInstance } from "@codev/contracts";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { z } from "zod";

const errorSchema = z.object({ error: z.string() });

export class OrchestratorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}

export interface ProvisionSandboxInput {
  workspaceId: string;
  repositoryUrl: string;
  baseSha: string;
  expiresAt: string;
}

export interface SandboxExecInput {
  command: string[];
  workingDir?: string | undefined;
  timeoutSeconds?: number | undefined;
  rows?: number | undefined;
  columns?: number | undefined;
}

function getOrchestratorConfiguration() {
  const environment = readServerEnvironment();
  if (!environment.AWS_REGION) {
    throw new Error("AWS_REGION is not configured.");
  }
  if (!environment.ORCHESTRATOR_URL) {
    throw new Error("ORCHESTRATOR_URL is not configured.");
  }
  const credentials = environment.AWS_ROLE_ARN
    ? awsCredentialsProvider({
        roleArn: environment.AWS_ROLE_ARN,
        roleSessionName: "codev-vercel",
      })
    : defaultProvider();
  return {
    region: environment.AWS_REGION,
    endpoint: environment.ORCHESTRATOR_URL,
    credentials,
  };
}

async function orchestratorRequest(
  method: string,
  path: string,
  body?: unknown,
) {
  const configuration = getOrchestratorConfiguration();
  const url = new URL(path, configuration.endpoint);
  const encodedBody = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = {
    accept: "application/json",
    host: url.host,
  };
  if (encodedBody !== undefined) {
    headers["content-type"] = "application/json";
  }
  const signer = new SignatureV4({
    credentials: configuration.credentials,
    region: configuration.region,
    service: "execute-api",
    sha256: Sha256,
  });
  const signed = await signer.sign(
    new HttpRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      ...(url.port ? { port: Number(url.port) } : {}),
      ...(encodedBody === undefined ? {} : { body: encodedBody }),
    }),
  );
  const response = await fetch(url, {
    method,
    headers: signed.headers,
    ...(encodedBody === undefined ? {} : { body: encodedBody }),
    cache: "no-store",
    signal: AbortSignal.timeout(70_000),
  });
  if (!response.ok) {
    const payload = errorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new OrchestratorError(
      payload.success
        ? payload.data.error
        : `Sandbox service returned HTTP ${response.status}.`,
      response.status,
    );
  }
  return response;
}

export async function checkOrchestratorConnection() {
  const response = await orchestratorRequest("GET", "/healthz");
  return z
    .object({
      status: z.literal("ok"),
      service: z.literal("codev-orchestrator"),
    })
    .parse(await response.json());
}

export async function provisionSandbox(
  input: ProvisionSandboxInput,
): Promise<SandboxInstance> {
  const response = await orchestratorRequest("POST", "/v1/sandboxes", input);
  const payload = z
    .object({ sandbox: sandboxInstanceSchema })
    .parse(await response.json());
  return payload.sandbox;
}

export async function getSandbox(
  workspaceId: string,
): Promise<SandboxInstance> {
  const response = await orchestratorRequest(
    "GET",
    `/v1/sandboxes/${workspaceId}`,
  );
  const payload = z
    .object({ sandbox: sandboxInstanceSchema })
    .parse(await response.json());
  return payload.sandbox;
}

export async function destroySandbox(workspaceId: string) {
  try {
    await orchestratorRequest("DELETE", `/v1/sandboxes/${workspaceId}`);
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 404) {
      return;
    }
    throw error;
  }
}

export async function readSandboxFile(workspaceId: string, path: string) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/files/read`,
    { path },
  );
  return z
    .object({
      file: z.object({
        path: z.string(),
        contents: z.string(),
        revision: z.string(),
      }),
    })
    .parse(await response.json()).file;
}

export async function writeSandboxFile(
  workspaceId: string,
  input: { path: string; contents: string; expectedRevision: string },
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/files/write`,
    input,
  );
  return z.object({ revision: z.string() }).parse(await response.json());
}

export async function executeInSandbox(
  workspaceId: string,
  input: SandboxExecInput,
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/pty/exec`,
    input,
  );
  return z
    .object({
      result: z.object({
        output: z.string(),
        exitCode: z.number().int(),
      }),
    })
    .parse(await response.json()).result;
}

export async function getSandboxGitOutput(
  workspaceId: string,
  operation: "status" | "diff",
) {
  const response = await orchestratorRequest(
    "GET",
    `/v1/sandboxes/${workspaceId}/git/${operation}`,
  );
  return z.object({ output: z.string() }).parse(await response.json()).output;
}
