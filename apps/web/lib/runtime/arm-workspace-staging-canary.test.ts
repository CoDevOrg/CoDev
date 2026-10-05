import { createHash, createPrivateKey, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  ArmWorkspaceProvider,
  capabilityToken,
} from "./arm-workspace-provider";

// Opt-in only: creates disposable Azure resources and verifies durable disk reuse.
it.skipIf(!process.env.CODEV_ARM_CANARY_CREDENTIAL_DIR)(
  "passes the ARM staging lifecycle canary",
  async () => {
    const directory = process.env.CODEV_ARM_CANARY_CREDENTIAL_DIR!;
    const credential = JSON.parse(
      await readFile(join(directory, "azure-client-credential.json"), "utf8"),
    );
    const cloudflare = JSON.parse(
      await readFile(join(directory, "token-response.json"), "utf8"),
    );
    Object.assign(process.env, {
      AZURE_TENANT_ID: credential.tenant,
      AZURE_SUBSCRIPTION_ID: "8ad43e43-af64-4d36-afc5-5e01b23833e4",
      ARM_WORKSPACE_AZURE_CLIENT_ID: credential.appId,
      ARM_WORKSPACE_AZURE_CLIENT_SECRET: credential.password,
      ARM_WORKSPACE_RESOURCE_GROUP: "codev-arm-workspace-staging",
      ARM_WORKSPACE_IMAGE_VERSION_ID:
        "/subscriptions/8ad43e43-af64-4d36-afc5-5e01b23833e4/resourceGroups/codev-arm-workspace-phase1/providers/Microsoft.Compute/galleries/codevarmworkspacegallery/images/codev-workspace-arm64/versions/1.0.11",
      ARM_WORKSPACE_SSH_PUBLIC_KEY: await readFile(
        join(directory, "ssh-ed25519.pub"),
        "utf8",
      ),
      ARM_WORKSPACE_SIGNING_PRIVATE_KEY: createPrivateKey(
        await readFile(join(directory, "signing-private.pem")),
      )
        .export({ type: "pkcs8", format: "der" })
        .toString("base64"),
      ARM_WORKSPACE_SIGNING_PUBLIC_KEY: await readFile(
        join(directory, "signing-public.pem"),
        "utf8",
      ),
      CLOUDFLARE_API_TOKEN: cloudflare.value,
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (String(args[0]).startsWith("https://management.azure.com/")) {
        const payload = (await response
          .clone()
          .json()
          .catch(() => null)) as {
          status?: string;
          error?: { code?: string };
        } | null;
        if (
          payload?.status === "Failed" ||
          (payload?.error && response.status !== 404)
        ) {
          await writeFile(
            join(directory, "staging-canary-azure-failure.json"),
            JSON.stringify(payload),
            { mode: 0o600 },
          );
        }
      }
      return response;
    };
    try {
      await lifecycle(directory);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
  1_800_000,
);

async function lifecycle(directory: string) {
  const provider = new ArmWorkspaceProvider();
  const workspaceId = process.env.CODEV_ARM_CANARY_WORKSPACE_ID ?? randomUUID();
  let resources: { diskId: string | null; diskUuid: string | null } = {
    diskId: null,
    diskUuid: null,
  };
  let generation = 1;
  const progress = async (
    status: string,
    update: Partial<typeof resources>,
  ) => {
    resources = { ...resources, ...update };
    console.log(`ARM canary ${workspaceId}: ${status}`);
    await writeFile(
      join(directory, "staging-canary-state.json"),
      JSON.stringify({ workspaceId, generation, status, resources }),
      { mode: 0o600 },
    );
  };
  try {
    const first = await provider.start(
      { workspaceId, generation, ...resources },
      progress,
    );
    resources = first;
    expect(
      await provider.healthy(
        workspaceId,
        generation,
        first.diskUuid,
        first.routeHost,
      ),
    ).toBe(true);
    const saved = await command(
      first.routeHost,
      workspaceId,
      generation,
      "printf staging-canary-persisted >/workspace/staging-canary.txt",
    );
    expect(saved.exitCode).toBe(0);
    await provider.stop({ workspaceId, generation, ...resources });
    generation = 2;
    const second = await provider.start(
      { workspaceId, generation, ...resources },
      progress,
    );
    resources = second;
    expect(second.diskUuid).toBe(first.diskUuid);
    expect(second.vmId).not.toBe(first.vmId);
    expect(
      (
        await command(
          second.routeHost,
          workspaceId,
          generation,
          "cat /workspace/staging-canary.txt",
        )
      ).output,
    ).toContain("staging-canary-persisted");
    const token = await capabilityToken(second.routeHost, workspaceId, 1);
    const stale = await fetch(`https://${second.routeHost}/v1/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    expect([401, 403]).toContain(stale.status);
    console.log(
      "ARM staging readiness, guest command, saved disk reopen, and stale generation rejection passed",
    );
  } finally {
    await provider.stop({ workspaceId, generation, ...resources });
    const diskId =
      resources.diskId ??
      `/subscriptions/${process.env.AZURE_SUBSCRIPTION_ID}/resourceGroups/codev-arm-workspace-staging/providers/Microsoft.Compute/disks/codev-ws-${createHash("sha256").update(workspaceId).digest("hex").slice(0, 16)}-data`;
    await provider.deleteDisk(diskId, workspaceId);
    await progress("cleaned", resources);
  }
}

async function command(
  host: string,
  workspaceId: string,
  generation: number,
  shell: string,
) {
  const body = JSON.stringify({
    command: ["sh", "-ec", shell],
    workingDir: "/workspace",
    timeoutSeconds: 30,
  });
  const request = {
    method: "POST",
    path: "/v1/pty/exec",
    scope: "workspace",
    body,
  };
  const token = await capabilityToken(host, workspaceId, generation, request);
  const response = await fetch(`https://${host}${request.path}`, {
    method: request.method,
    body,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(45_000),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ output: string; exitCode: number }>;
}
