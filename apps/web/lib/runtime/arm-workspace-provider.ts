import "server-only";

import type { Gen2RuntimeStatus } from "@codev/contracts";
import { ArmWorkflowIO } from "./arm-workflow-io";

import { createClientSecretCredential } from "./azure";
import { readArmWorkspaceConfig } from "./arm-workspace-config";
import { logEvent } from "../platform/observability";
import { ArmWorkspaceRuntimeError } from "./arm-workspace-error";
export { ArmWorkspaceRuntimeError } from "./arm-workspace-error";

import armDiskPreparation from "../../../../infra/runtime/scripts/prepare-arm-workspace-disk.sh?raw";
import armConnectionInstaller from "../../../../infra/runtime/scripts/install-arm-workspace-connection.sh?raw";
import armGatewayCapability from "../../../../infra/runtime/scripts/arm-workspace-capability.mjs?raw";
import armBootstrap from "../../../../infra/runtime/scripts/arm-workspace-bootstrap.mjs?raw";
import armGateway from "../../../../infra/runtime/scripts/arm-workspace-gateway.mjs?raw";
import armGatewayEntrypoint from "../../../../infra/runtime/scripts/start-arm-workspace-gateway.mjs?raw";

const MANAGEMENT_SCOPE = "https://management.azure.com/.default";
const COMPUTE_API = "2024-07-01";
const NETWORK_API = "2024-05-01";
const DISK_API = "2024-03-02";
const DEPLOYMENT_API = "2025-04-01";
const WORKSPACE_LOCATION = "westus2";
// Keep Azure polling under Cloudflare Workflows' subrequest budget.
const VM_POLL_INTERVAL_MS = 10_000;
const ARM_OPERATION_POLL_INTERVAL_MS = 5_000;
const CLOUDFLARE_ACCOUNT_ID = "84a1d01866de04e04320feddfb199b83";
const CLOUDFLARE_ZONE_ID = "c474dbc7af01ea073573a250fbd1d5ec";
const CLOUDFLARE_ZONE_NAME = "trycodev.com";
const PHASE2_SIGNING_ISSUER = "codev-control-plane";
const SHARED_NSG = "codev-arm-workspace-nsg";
const SHARED_VNET = "codev-arm-workspace-vnet";

export type ArmWorkspaceOperation = {
  workspaceId: string;
  generation: number;
  diskId: string | null;
  diskUuid: string | null;
  resume?: {
    status: Gen2RuntimeStatus;
    vmId: string | null;
    tunnelId: string | null;
    routeHost: string | null;
  };
};

export type ArmWorkspaceProgress = (
  status:
    | "provisioning"
    | "booting"
    | "attaching_disk"
    | "starting_tunnel"
    | "checking_readiness",
  resources: Partial<{
    vmId: string;
    diskId: string;
    diskUuid: string;
    tunnelId: string;
    routeHost: string;
  }>,
) => Promise<void>;

function fail(code: string): never {
  throw new ArmWorkspaceRuntimeError(code);
}

function checkTags(
  resource: { tags?: Record<string, string> },
  workspaceId: string,
  generation?: number,
) {
  if (
    resource.tags?.Runtime !== "arm-workspace" ||
    resource.tags?.WorkspaceId !== workspaceId ||
    (generation !== undefined &&
      resource.tags?.Generation !== String(generation))
  ) {
    fail("RESOURCE_OWNERSHIP_MISMATCH");
  }
}

let cachedCredential:
  | ReturnType<typeof createClientSecretCredential>
  | undefined;

function getCredential() {
  if (cachedCredential) return cachedCredential;
  const config = readArmWorkspaceConfig();
  cachedCredential = createClientSecretCredential(
    config.tenantId,
    config.clientId,
    config.clientSecret,
  );
  return cachedCredential;
}

function apiUrl(path: string, version: string) {
  return `https://management.azure.com${path}${path.includes("?") ? "&" : "?"}api-version=${version}`;
}

async function resourceName(workspaceId: string) {
  return `codev-ws-${(await sha256Hex(workspaceId)).slice(0, 16)}`;
}

function errorCode(payload: unknown, status: number) {
  if (typeof payload === "object" && payload !== null) {
    const error = (payload as { error?: { code?: unknown } }).error;
    if (typeof error?.code === "string") return error.code;
  }
  return status === 404 ? "ResourceNotFound" : `ARM_HTTP_${status}`;
}

async function token() {
  try {
    const value = await getCredential().getToken(MANAGEMENT_SCOPE);
    if (!value?.token) fail("AZURE_AUTHENTICATION_FAILED");
    return value.token;
  } catch (error) {
    if (error instanceof ArmWorkspaceRuntimeError) throw error;
    fail("AZURE_AUTHENTICATION_FAILED");
  }
}

async function armFetchDirect(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<{ response: Response; payload: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${await token()}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof ArmWorkspaceRuntimeError) throw error;
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause
        : undefined;
    logEvent("error", "gen2.arm.azure_transport_failed", {
      method,
      path: new URL(url).pathname,
      errorName: error instanceof Error ? error.name : "UnknownError",
      reason:
        error instanceof Error ? error.message : "Unknown transport error",
      causeName: cause?.name,
      cause: cause?.message,
      causeCode:
        typeof cause === "object" && cause !== null && "code" in cause
          ? String(cause.code)
          : undefined,
    });
    fail("AZURE_REQUEST_FAILED");
  }
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

/** A function body is built inside the checkpoint, so secrets it carries are never journaled. */
async function armFetch(url: string, method = "GET", body?: unknown) {
  return ArmWorkflowIO.request("azure", async () =>
    armFetchDirect(
      url,
      method,
      typeof body === "function" ? await body() : body,
    ),
  );
}

type PollInterval = (elapsedMs: number) => number;

const steadyPoll: PollInterval = () => ARM_OPERATION_POLL_INTERVAL_MS;

// Production VM deployments finish 35-60 s after submission and send no
// Retry-After. Skip early polls, then check often around the usual finish.
const deploymentPoll: PollInterval = (elapsed) =>
  elapsed < 30_000
    ? 30_000 - elapsed
    : elapsed >= 40_000 && elapsed < 70_000
      ? 2_000
      : ARM_OPERATION_POLL_INTERVAL_MS;

async function pollArmOperation(
  response: Response,
  payload: unknown,
  interval: PollInterval,
) {
  let operationUrl =
    response.headers.get("azure-asyncoperation") ??
    response.headers.get("location");
  if (!operationUrl) fail("AZURE_OPERATION_URL_MISSING");
  const started = await ArmWorkflowIO.deadline(0);
  const deadline = started + 10 * 60_000;
  let result = payload;
  let retryAfter = response.headers.get("retry-after");
  while (Date.now() < deadline) {
    const retryAfterSeconds = Number(retryAfter ?? 0);
    await ArmWorkflowIO.sleep(
      Math.max(
        interval(Date.now() - started),
        (Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 5) * 1000,
      ),
    );
    const poll = await armFetch(operationUrl);
    if (!poll.response.ok) fail(errorCode(poll.payload, poll.response.status));
    result = poll.payload;
    const state =
      typeof result === "object" && result !== null
        ? (result as {
            status?: string;
            properties?: { provisioningState?: string };
          })
        : undefined;
    const status = state?.status ?? state?.properties?.provisioningState;
    if (status === "Succeeded" || status === "succeeded") return result;
    if (status === "Failed" || status === "Canceled" || status === "failed") {
      fail("AZURE_OPERATION_FAILED");
    }
    operationUrl =
      poll.response.headers.get("azure-asyncoperation") ?? operationUrl;
    // Each response's Retry-After governs only the next poll.
    retryAfter = poll.response.headers.get("retry-after");
  }
  fail("AZURE_OPERATION_TIMEOUT");
}

async function armRequest(
  path: string,
  version: string,
  method = "GET",
  body?: unknown,
  allowNotFound = false,
  interval = steadyPoll,
): Promise<unknown> {
  const result = await armFetch(apiUrl(path, version), method, body);
  if (allowNotFound && result.response.status === 404) return null;
  if (
    result.response.status === 202 ||
    result.response.headers.has("azure-asyncoperation") ||
    (result.response.status === 201 && result.response.headers.has("location"))
  ) {
    const completed = await pollArmOperation(
      result.response,
      result.payload,
      interval,
    );
    // Azure operation endpoints return status, not the created resource.
    return method === "PUT" ? armRequest(path, version) : completed;
  }
  if (!result.response.ok)
    fail(errorCode(result.payload, result.response.status));
  return result.payload;
}

function deploymentTemplate(
  workspaceId: string,
  generation: number,
  diskId: string,
  boot: boolean,
) {
  const config = readArmWorkspaceConfig();
  const tags = {
    Project: "CoDev",
    Runtime: "arm-workspace",
    WorkspaceId: workspaceId,
    Generation: String(generation),
  };
  return {
    $schema:
      "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    contentVersion: "1.0.0.0",
    parameters: {
      instanceName: { type: "string" },
      workspaceId: { type: "string" },
      generation: { type: "int" },
      imageVersionId: { type: "string" },
      dataDiskResourceId: { type: "string" },
      adminSshPublicKey: { type: "string" },
      ...(boot ? { bootScript: { type: "secureString" } } : {}),
    },
    variables: {
      resourceTags: tags,
      // Shared per resource group by infra/azure/arm-workspace-network.bicep.
      nsgId: `[resourceId('Microsoft.Network/networkSecurityGroups', '${SHARED_NSG}')]`,
      subnetId: `[resourceId('Microsoft.Network/virtualNetworks/subnets', '${SHARED_VNET}', 'workspace')]`,
      ipId: "[resourceId('Microsoft.Network/publicIPAddresses', format('{0}-ip', parameters('instanceName')))]",
      nicId:
        "[resourceId('Microsoft.Network/networkInterfaces', format('{0}-nic', parameters('instanceName')))]",
    },
    resources: [
      {
        type: "Microsoft.Network/publicIPAddresses",
        apiVersion: NETWORK_API,
        name: "[format('{0}-ip', parameters('instanceName'))]",
        location: WORKSPACE_LOCATION,
        tags: "[variables('resourceTags')]",
        sku: { name: "Standard" },
        properties: { publicIPAllocationMethod: "Static" },
      },
      {
        type: "Microsoft.Network/networkInterfaces",
        apiVersion: NETWORK_API,
        name: "[format('{0}-nic', parameters('instanceName'))]",
        location: WORKSPACE_LOCATION,
        tags: "[variables('resourceTags')]",
        dependsOn: ["[variables('ipId')]"],
        properties: {
          enableAcceleratedNetworking: true,
          networkSecurityGroup: { id: "[variables('nsgId')]" },
          ipConfigurations: [
            {
              name: "primary",
              properties: {
                privateIPAllocationMethod: "Dynamic",
                subnet: { id: "[variables('subnetId')]" },
                publicIPAddress: { id: "[variables('ipId')]" },
              },
            },
          ],
        },
      },
      {
        type: "Microsoft.Compute/virtualMachines",
        apiVersion: COMPUTE_API,
        name: "[parameters('instanceName')]",
        location: WORKSPACE_LOCATION,
        tags: "[variables('resourceTags')]",
        dependsOn: ["[variables('nicId')]"],
        properties: {
          hardwareProfile: { vmSize: "Standard_D2ps_v6" },
          storageProfile: {
            imageReference: { id: "[parameters('imageVersionId')]" },
            osDisk: {
              name: "[format('{0}-os', parameters('instanceName'))]",
              createOption: "FromImage",
              deleteOption: "Delete",
              managedDisk: { storageAccountType: "StandardSSD_LRS" },
            },
            dataDisks: [
              {
                lun: 0,
                createOption: "Attach",
                caching: "None",
                deleteOption: "Detach",
                managedDisk: { id: "[parameters('dataDiskResourceId')]" },
              },
            ],
          },
          osProfile: {
            computerName: "[parameters('instanceName')]",
            adminUsername: "codevadmin",
            linuxConfiguration: {
              disablePasswordAuthentication: true,
              ssh: {
                publicKeys: [
                  {
                    path: "/home/codevadmin/.ssh/authorized_keys",
                    keyData: "[parameters('adminSshPublicKey')]",
                  },
                ],
              },
            },
          },
          networkProfile: {
            networkInterfaces: [
              {
                id: "[variables('nicId')]",
                properties: { deleteOption: "Delete" },
              },
            ],
          },
        },
      },
      ...(boot
        ? [
            {
              type: "Microsoft.Compute/virtualMachines/extensions",
              apiVersion: COMPUTE_API,
              name: "[format('{0}/CustomScript', parameters('instanceName'))]",
              location: WORKSPACE_LOCATION,
              dependsOn: [
                "[resourceId('Microsoft.Compute/virtualMachines', parameters('instanceName'))]",
              ],
              properties: {
                publisher: "Microsoft.Azure.Extensions",
                type: "CustomScript",
                typeHandlerVersion: "2.1",
                autoUpgradeMinorVersion: false,
                protectedSettings: { script: "[parameters('bootScript')]" },
              },
            },
          ]
        : []),
    ],
    outputs: {
      vmResourceId: {
        type: "string",
        value:
          "[resourceId('Microsoft.Compute/virtualMachines', parameters('instanceName'))]",
      },
      dataDiskId: { type: "string", value: diskId },
      workspace: { type: "string", value: workspaceId },
      generation: { type: "int", value: generation },
      imageVersionId: { type: "string", value: config.imageVersionId },
    },
  };
}

function azureTags(workspaceId: string) {
  return {
    Project: "CoDev",
    Runtime: "arm-workspace",
    WorkspaceId: workspaceId,
  };
}

function vmId(workspaceId: string, generation: number) {
  const config = readArmWorkspaceConfig();
  return resourceName(workspaceId).then(
    (name) =>
      `/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}/providers/Microsoft.Compute/virtualMachines/${name}-g${generation}`,
  );
}

async function resourceIds(
  workspaceId: string,
  generation: number,
): Promise<[string, string, string, string, string]> {
  const config = readArmWorkspaceConfig();
  const name = `${await resourceName(workspaceId)}-g${generation}`;
  const root = `/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}/providers/Microsoft.Network`;
  // Generations deployed before the shared network also own a VNet and NSG;
  // deleting them is a no-op once those generations are gone.
  return [
    await vmId(workspaceId, generation),
    `${root}/networkInterfaces/${name}-nic`,
    `${root}/publicIPAddresses/${name}-ip`,
    `${root}/networkSecurityGroups/${name}-nsg`,
    `${root}/virtualNetworks/${name}-vnet`,
  ];
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

async function gzipBase64(value: string) {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(new TextEncoder().encode(value));
  await writer.close();
  return bytesToBase64(
    new Uint8Array(await new Response(stream.readable).arrayBuffer()),
  );
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function workspaceTunnelName(workspaceId: string, generation: number) {
  return `codev-${(await sha256Hex(workspaceId)).slice(0, 20)}-g${generation}`;
}

export async function capabilityToken(
  host: string,
  workspaceId: string,
  generation: number,
  request = { method: "GET", path: "/v1/health", scope: "health", body: "" },
) {
  const config = readArmWorkspaceConfig();
  const key = await crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(config.signingPrivateKey),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const encodeJson = (value: unknown) =>
    base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "EdDSA", typ: "JWT" });
  const claims = encodeJson({
    iss: PHASE2_SIGNING_ISSUER,
    aud: host,
    workspaceId,
    generation,
    method: request.method,
    path: request.path,
    scope: request.scope,
    bodySha256: await sha256Hex(request.body),
    iat: issuedAt,
    exp: issuedAt + 60,
  });
  const message = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(message),
  );
  return `${message}.${base64Url(new Uint8Array(signature))}`;
}

async function cloudflareRequestDirect<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const config = readArmWorkspaceConfig();
  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.cloudflareToken}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail("CLOUDFLARE_TUNNEL_FAILED");
  }
  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    result?: T;
  } | null;
  if (!response.ok || !payload?.success) fail("CLOUDFLARE_TUNNEL_FAILED");
  return payload.result as T;
}

/** `select` runs inside the checkpoint, so only its result is journaled. */
async function cloudflareRequest<T, R = T>(
  path: string,
  method = "GET",
  body?: unknown,
  select: (result: T) => R = (result) => result as unknown as R,
): Promise<R> {
  return ArmWorkflowIO.checkpoint("azure", async () =>
    select(await cloudflareRequestDirect<T>(path, method, body)),
  );
}

type TunnelIdentity = { id: string; name: string };

// Tunnel responses carry connector credentials; journal only the identity.
const tunnelIdentity = ({ id, name }: TunnelIdentity) => ({ id, name });
const discard = () => null;

async function findTunnel(workspaceId: string, generation: number) {
  const name = await workspaceTunnelName(workspaceId, generation);
  const tunnels = await cloudflareRequest(
    `/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`,
    "GET",
    undefined,
    (result: TunnelIdentity[]) => result.map(tunnelIdentity),
  );
  return tunnels.find((tunnel) => tunnel.name === name) ?? null;
}

/** Call only inside a checkpoint whose output excludes the token. */
function tunnelToken(tunnelId: string) {
  return cloudflareRequestDirect<string>(
    `/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnelId}/token`,
  );
}

async function ensureTunnel(workspaceId: string, generation: number) {
  const name = await workspaceTunnelName(workspaceId, generation);
  const tunnel =
    (await findTunnel(workspaceId, generation)) ??
    (await cloudflareRequest(
      `/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel`,
      "POST",
      { name, config_src: "cloudflare" },
      tunnelIdentity,
    ));
  const host = `${name}.${CLOUDFLARE_ZONE_NAME}`;
  await cloudflareRequest(
    `/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnel.id}/configurations`,
    "PUT",
    {
      config: {
        ingress: [
          { hostname: host, service: "http://127.0.0.1:5260" },
          { service: "http_status:404" },
        ],
      },
    },
  );
  const records = await cloudflareRequest<
    Array<{ id: string; name: string; content: string }>
  >(
    `/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${encodeURIComponent(host)}&type=CNAME`,
  );
  const target = `${tunnel.id}.cfargotunnel.com`;
  if (records.some((record) => record.content !== target))
    fail("CLOUDFLARE_DNS_CONFLICT");
  if (!records.some((record) => record.content === target)) {
    await cloudflareRequest(
      `/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
      "POST",
      {
        type: "CNAME",
        name: host,
        content: target,
        proxied: true,
        ttl: 1,
      },
    );
  }
  return { id: tunnel.id, host };
}

async function revokeTunnelRoute(workspaceId: string, generation: number) {
  const tunnel = await findTunnel(workspaceId, generation);
  if (!tunnel) return;
  const host = `${tunnel.name}.${CLOUDFLARE_ZONE_NAME}`;
  const records = await cloudflareRequest<
    Array<{ id: string; name: string; content: string }>
  >(
    `/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${encodeURIComponent(host)}`,
  );
  for (const record of records.filter(
    (entry) =>
      entry.name === host && entry.content === `${tunnel.id}.cfargotunnel.com`,
  )) {
    await cloudflareRequest(
      `/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${record.id}`,
      "DELETE",
    );
  }
  return tunnel;
}

async function deleteTunnel(workspaceId: string, generation: number) {
  const tunnel = await revokeTunnelRoute(workspaceId, generation);
  if (!tunnel) return;
  await cloudflareRequest(
    `/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnel.id}/connections`,
    "DELETE",
    undefined,
    discard,
  );
  await cloudflareRequest(
    `/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnel.id}`,
    "DELETE",
    undefined,
    discard,
  );
}

async function createDisk(workspaceId: string) {
  const config = readArmWorkspaceConfig();
  const diskName = `${await resourceName(workspaceId)}-data`;
  const path = `/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}/providers/Microsoft.Compute/disks/${diskName}`;
  const existing = (await armRequest(
    path,
    DISK_API,
    "GET",
    undefined,
    true,
  )) as {
    id?: string;
    tags?: Record<string, string>;
    sku?: { name?: string };
    managedBy?: string | null;
    properties?: {
      diskSizeGB?: number;
      diskState?: string;
      managedBy?: string;
    };
  } | null;
  if (existing) {
    checkTags(existing, workspaceId);
    if (
      existing.sku?.name !== "StandardSSD_LRS" ||
      existing.properties?.diskSizeGB !== 16
    ) {
      fail("DISK_SIZE_MISMATCH");
    }
    return existing.id ?? path;
  }
  const created = (await armRequest(path, DISK_API, "PUT", {
    location: WORKSPACE_LOCATION,
    sku: { name: "StandardSSD_LRS" },
    tags: azureTags(workspaceId),
    properties: { diskSizeGB: 16, creationData: { createOption: "Empty" } },
  })) as { id?: string; tags?: Record<string, string> };
  if (!created.id) fail("DISK_CREATE_FAILED");
  checkTags(created, workspaceId);
  return created.id;
}

async function requireDisk(
  diskId: string,
  workspaceId: string,
  generation: number,
) {
  const disk = (await armRequest(diskId, DISK_API, "GET", undefined, true)) as {
    id?: string;
    tags?: Record<string, string>;
    sku?: { name?: string };
    managedBy?: string | null;
    properties?: { diskSizeGB?: number; diskState?: string };
  } | null;
  if (!disk?.id) fail("DISK_MISSING");
  checkTags(disk, workspaceId);
  if (
    disk.sku?.name !== "StandardSSD_LRS" ||
    disk.properties?.diskSizeGB !== 16
  ) {
    fail("DISK_SIZE_MISMATCH");
  }
  if (
    disk.managedBy &&
    disk.managedBy.toLowerCase() !==
      (await vmId(workspaceId, generation)).toLowerCase()
  )
    fail("DISK_ATTACH_CONFLICT");
  return disk.id;
}

async function deployVm(
  workspaceId: string,
  generation: number,
  diskId: string,
  bootScript?: () => Promise<string>,
) {
  const config = readArmWorkspaceConfig();
  const name = `${await resourceName(workspaceId)}-g${generation}`;
  const path = `/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}/providers/Microsoft.Resources/deployments/${name}`;
  const virtualMachineId = await vmId(workspaceId, generation);
  const existing = (await armRequest(
    `${virtualMachineId}?%24expand=instanceView`,
    COMPUTE_API,
    "GET",
    undefined,
    true,
  )) as {
    id?: string;
    tags?: Record<string, string>;
    properties?: {
      hardwareProfile?: { vmSize?: string };
      storageProfile?: {
        dataDisks?: Array<{ managedDisk?: { id?: string } }>;
      };
    };
  } | null;
  if (existing?.id) {
    checkTags(existing, workspaceId, generation);
    if (
      existing.properties?.hardwareProfile?.vmSize !== "Standard_D2ps_v6" ||
      existing.properties.storageProfile?.dataDisks?.length !== 1 ||
      existing.properties.storageProfile.dataDisks[0]?.managedDisk?.id?.toLowerCase() !==
        diskId.toLowerCase()
    ) {
      fail("DISK_ATTACH_CONFLICT");
    }
    return existing.id;
  }
  const deployment = async () => ({
    properties: {
      mode: "Incremental",
      template: deploymentTemplate(
        workspaceId,
        generation,
        diskId,
        Boolean(bootScript),
      ),
      parameters: {
        instanceName: { value: name },
        workspaceId: { value: workspaceId },
        generation: { value: generation },
        imageVersionId: { value: config.imageVersionId },
        dataDiskResourceId: { value: diskId },
        adminSshPublicKey: { value: config.sshPublicKey },
        ...(bootScript ? { bootScript: { value: await bootScript() } } : {}),
      },
    },
  });
  await armRequest(
    path,
    DEPLOYMENT_API,
    "PUT",
    deployment,
    false,
    deploymentPoll,
  );
  const vm = (await armRequest(
    `${virtualMachineId}?%24expand=instanceView`,
    COMPUTE_API,
  )) as { id?: string; tags?: Record<string, string> };
  if (!vm.id) fail("VM_CREATE_FAILED");
  checkTags(vm, workspaceId, generation);
  return vm.id;
}

async function waitForVmReady(
  workspaceId: string,
  generation: number,
  heartbeat: () => Promise<void>,
) {
  const deadline = await ArmWorkflowIO.deadline(10 * 60_000);
  const resource = await vmId(workspaceId, generation);
  while (Date.now() < deadline) {
    const vm = (await armRequest(
      `${resource}?%24expand=instanceView`,
      COMPUTE_API,
    )) as {
      tags?: Record<string, string>;
      properties?: {
        instanceView?: {
          statuses?: Array<{ code?: string }>;
          vmAgent?: { statuses?: Array<{ code?: string }> };
        };
      };
    };
    checkTags(vm, workspaceId, generation);
    const power = vm.properties?.instanceView?.statuses?.find((status) =>
      status.code?.startsWith("PowerState/"),
    )?.code;
    const agent = vm.properties?.instanceView?.vmAgent?.statuses?.some(
      (status) => status.code === "ProvisioningState/succeeded",
    );
    if (power === "PowerState/running" && agent) return;
    if (power === "PowerState/deallocated" || power === "PowerState/stopped") {
      fail("VM_FAILED_TO_START");
    }
    await heartbeat();
    await ArmWorkflowIO.sleep(VM_POLL_INTERVAL_MS);
  }
  fail("VM_BOOT_TIMEOUT");
}

async function runVmCommand(
  workspaceId: string,
  generation: number,
  script: string,
  parameters: Array<{ name: string; value: string }> = [],
) {
  const resource = await vmId(workspaceId, generation);
  const commandName = `codev-${(
    await sha256Hex(JSON.stringify({ script, parameters }))
  ).slice(0, 24)}`;
  const commandId = `${resource}/runCommands/${commandName}`;
  await armRequest(commandId, COMPUTE_API, "PUT", {
    location: WORKSPACE_LOCATION,
    properties: {
      source: { script },
      parameters,
      asyncExecution: true,
      timeoutInSeconds: 600,
      treatFailureAsDeploymentFailure: true,
    },
  });
  const deadline = await ArmWorkflowIO.deadline(10 * 60_000);
  while (Date.now() < deadline) {
    const result = (await armRequest(
      `${commandId}?%24expand=instanceView`,
      COMPUTE_API,
    )) as {
      properties?: {
        provisioningState?: string;
        instanceView?: {
          executionState?: string;
          output?: string;
          error?: string;
          exitCode?: number;
        };
      };
    };
    const view = result.properties?.instanceView;
    const state = view?.executionState ?? result.properties?.provisioningState;
    if (
      state === "Succeeded" ||
      state === "Failed" ||
      state === "TimedOut" ||
      state === "Canceled"
    ) {
      const output = view?.output ?? "";
      if (state !== "Succeeded" || view?.exitCode !== 0 || view.error) {
        const code = output.match(/\b[A-Z][A-Z0-9_]{2,}\b/)?.[0];
        fail(code ?? "GUEST_COMMAND_FAILED");
      }
      await deleteResource(commandId, COMPUTE_API).catch(() => undefined);
      return output;
    }
    await ArmWorkflowIO.sleep(VM_POLL_INTERVAL_MS);
  }
  fail("GUEST_COMMAND_TIMEOUT");
}

async function prepareDisk(
  workspaceId: string,
  generation: number,
  expectedUuid: string | null,
) {
  const current = await runVmCommand(
    workspaceId,
    generation,
    "disk=/dev/disk/azure/scsi1/lun0; if [[ -b $disk ]]; then uuid=$(blkid -s UUID -o value $disk || true); [[ -z $uuid ]] && echo UNFORMATTED || echo $uuid; else echo DISK_MISSING; fi",
  );
  if (current.includes("DISK_MISSING")) fail("DISK_MISSING");
  const foundUuid =
    current.match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/)?.[0] ?? null;
  if (expectedUuid && foundUuid !== expectedUuid)
    fail("DISK_IDENTITY_MISMATCH");
  const mode = foundUuid ? "existing" : "new";
  if (mode === "new" && expectedUuid) fail("DISK_IDENTITY_MISMATCH");
  const output = await runVmCommand(
    workspaceId,
    generation,
    armDiskPreparation,
    [
      { name: "CODEV_DISK_MODE", value: mode },
      { name: "CODEV_DISK_EXPECTED_UUID", value: foundUuid ?? "" },
    ],
  );
  const uuid = output.match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/)?.[0];
  if (!uuid || (foundUuid && uuid !== foundUuid))
    fail("DISK_IDENTITY_MISMATCH");
  return uuid;
}

async function installConnection(
  workspaceId: string,
  generation: number,
  diskUuid: string,
) {
  const tunnel = await ensureTunnel(workspaceId, generation);
  const ext = `${await vmId(workspaceId, generation)}/extensions/CustomScript`;
  await armRequest(ext, COMPUTE_API, "PUT", async () =>
    connectionExtension(workspaceId, generation, diskUuid, tunnel),
  );
  return { tunnelId: tunnel.id, routeHost: tunnel.host };
}

async function connectionExtension(
  workspaceId: string,
  generation: number,
  diskUuid: string,
  tunnel: { id: string; host: string },
) {
  const config = readArmWorkspaceConfig();
  const identity = {
    workspaceId,
    generation,
    audience: tunnel.host,
    diskUuid,
    verificationKey: config.signingPublicKey,
    tunnelToken: await tunnelToken(tunnel.id),
  };
  let script =
    "#!/bin/bash\nset -euo pipefail\numask 077\ninstall -d -m 0755 /usr/local/lib/codev\n";
  const scripts = [
    ["arm-workspace-capability.mjs", armGatewayCapability],
    ["arm-workspace-gateway.mjs", armGateway],
    ["arm-workspace-bootstrap.mjs", armBootstrap],
    ["start-arm-workspace-gateway.mjs", armGatewayEntrypoint],
  ];
  for (const [name, contents] of scripts) {
    script += `base64 -d > /usr/local/lib/codev/${name} <<'DATA'\n${bytesToBase64(new TextEncoder().encode(contents))}\nDATA\nchmod 0644 /usr/local/lib/codev/${name}\n`;
  }
  script += `base64 -d > /root/codev-install-connection.sh <<'DATA'\n${bytesToBase64(new TextEncoder().encode(armConnectionInstaller))}\nDATA\n`;
  script += `base64 -d <<'CONFIG' | bash /root/codev-install-connection.sh\n${bytesToBase64(new TextEncoder().encode(JSON.stringify(identity)))}\nCONFIG\nrm -f /root/codev-install-connection.sh\n`;
  return {
    location: WORKSPACE_LOCATION,
    properties: {
      publisher: "Microsoft.Azure.Extensions",
      type: "CustomScript",
      typeHandlerVersion: "2.1",
      autoUpgradeMinorVersion: false,
      protectedSettings: { script: await gzipBase64(script) },
    },
  };
}

async function waitForHealth(
  workspaceId: string,
  generation: number,
  diskUuid: string,
  routeHost: string,
  heartbeat: () => Promise<void>,
) {
  const deadline = await ArmWorkflowIO.deadline(
    readArmWorkspaceConfig().bootEnabled ? 10 * 60_000 : 3 * 60_000,
  );
  while (Date.now() < deadline) {
    try {
      const authorization = `Bearer ${await capabilityToken(routeHost, workspaceId, generation)}`;
      const { ok, value } = await ArmWorkflowIO.checkpoint(
        "health",
        async () => {
          const response = await fetch(`https://${routeHost}/v1/health`, {
            headers: { authorization },
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          });
          const value = (await response.json().catch(() => null)) as {
            ready?: boolean;
            workspaceId?: string;
            generation?: number;
            diskUuid?: string;
          } | null;
          return { ok: response.ok, value };
        },
      );
      if (
        ok &&
        value?.ready &&
        value.workspaceId === workspaceId &&
        value.generation === generation &&
        value.diskUuid === diskUuid
      )
        return;
    } catch (error) {
      // A handoff must not spin in place until the readiness deadline.
      if (
        error instanceof ArmWorkspaceRuntimeError &&
        error.code === "WORKFLOW_CONTINUE"
      )
        throw error;
      // The connector and guest bridge can take time to join after boot.
    }
    await heartbeat();
    await ArmWorkflowIO.sleep(5_000);
  }
  fail("GUEST_READINESS_TIMEOUT");
}

async function deleteResource(id: string, version: string) {
  await armRequest(id, version, "DELETE", undefined, true);
}

async function deallocateVm(
  id: string,
  workspaceId: string,
  generation: number,
) {
  const readVm = () =>
    armRequest(
      `${id}?%24expand=instanceView`,
      COMPUTE_API,
      "GET",
      undefined,
      true,
    ) as Promise<{
      tags?: Record<string, string>;
      properties?: { instanceView?: { statuses?: Array<{ code?: string }> } };
    } | null>;
  const powerState = (vm: Awaited<ReturnType<typeof readVm>>) =>
    vm?.properties?.instanceView?.statuses?.find((status) =>
      status.code?.startsWith("PowerState/"),
    )?.code;
  let vm = await readVm();
  if (!vm) return;
  checkTags(vm, workspaceId, generation);
  if (powerState(vm) !== "PowerState/deallocated") {
    await armRequest(`${id}/deallocate`, COMPUTE_API, "POST");
  }
  const deadline = await ArmWorkflowIO.deadline(5 * 60_000);
  while (Date.now() < deadline) {
    vm = await readVm();
    if (!vm) return;
    checkTags(vm, workspaceId, generation);
    if (powerState(vm) === "PowerState/deallocated") return;
    await ArmWorkflowIO.sleep(5_000);
  }
  fail("VM_DEALLOCATION_TIMEOUT");
}

function resumePhase(input: ArmWorkspaceOperation) {
  return Math.max(
    0,
    [
      "provisioning",
      "booting",
      "attaching_disk",
      "starting_tunnel",
      "checking_readiness",
    ].indexOf(input.resume?.status ?? "queued"),
  );
}

async function prepareRuntime(
  input: ArmWorkspaceOperation,
  progress: ArmWorkspaceProgress,
) {
  const phase = resumePhase(input);
  const diskId =
    phase > 0 && input.diskId
      ? input.diskId
      : input.diskId
        ? await requireDisk(input.diskId, input.workspaceId, input.generation)
        : await createDisk(input.workspaceId);
  let resourceVmId = input.resume?.vmId;
  if (phase === 0 || !resourceVmId) {
    await progress("provisioning", { diskId });
    resourceVmId = await deployVm(input.workspaceId, input.generation, diskId);
    await progress("booting", { vmId: resourceVmId, diskId });
  }
  const resources = { vmId: resourceVmId, diskId };
  if (phase < 2) {
    await waitForVmReady(input.workspaceId, input.generation, () =>
      progress("booting", resources),
    );
    await progress("attaching_disk", resources);
  }
  const diskUuid =
    phase >= 3 && input.diskUuid
      ? input.diskUuid
      : await prepareDisk(input.workspaceId, input.generation, input.diskUuid);
  if (phase < 3) await progress("starting_tunnel", { ...resources, diskUuid });
  return { ...resources, diskUuid };
}

async function connectRuntime(
  input: ArmWorkspaceOperation,
  progress: ArmWorkspaceProgress,
  resources: Awaited<ReturnType<typeof prepareRuntime>>,
) {
  const resume = input.resume;
  const route =
    resumePhase(input) >= 4 && resume?.tunnelId && resume.routeHost
      ? { tunnelId: resume.tunnelId, routeHost: resume.routeHost }
      : await installConnection(
          input.workspaceId,
          input.generation,
          resources.diskUuid,
        );
  const ready = { ...resources, ...route };
  if (resumePhase(input) < 4) await progress("checking_readiness", ready);
  await waitForHealth(
    input.workspaceId,
    input.generation,
    resources.diskUuid,
    route.routeHost,
    () => progress("checking_readiness", ready),
  );
  return ready;
}

async function bakedBootScript(
  input: ArmWorkspaceOperation,
  diskUuid: string,
  routeHost: string,
  token: string,
) {
  const { workspaceId, generation } = input;
  const config = readArmWorkspaceConfig();
  const identity = {
    workspaceId,
    generation,
    audience: routeHost,
    diskUuid,
    verificationKey: config.signingPublicKey,
    tunnelToken: token,
    diskMode: input.diskId ? "existing" : "new",
  };
  const encoded = bytesToBase64(
    new TextEncoder().encode(JSON.stringify(identity)),
  );
  return gzipBase64(
    `#!/bin/bash\nset -euo pipefail\numask 077\nbase64 -d <<'CONFIG' | /usr/local/sbin/codev-activate-arm-boot\n${encoded}\nCONFIG\n`,
  );
}

async function deployBakedVm(
  input: ArmWorkspaceOperation,
  progress: ArmWorkspaceProgress,
  diskId: string,
  diskUuid: string,
  route: { tunnelId: string; routeHost: string },
) {
  const { workspaceId, generation } = input;
  let virtualMachineId = resumePhase(input) > 0 ? input.resume?.vmId : null;
  if (!virtualMachineId) {
    await progress("provisioning", { diskId, diskUuid, ...route });
    virtualMachineId = await deployVm(
      workspaceId,
      generation,
      diskId,
      async () =>
        bakedBootScript(
          input,
          diskUuid,
          route.routeHost,
          await tunnelToken(route.tunnelId),
        ),
    );
  }
  return virtualMachineId;
}

async function prepareBakedResources(
  input: ArmWorkspaceOperation,
  progress: ArmWorkspaceProgress,
) {
  const { workspaceId, generation } = input;
  // An unidentified saved disk never becomes a fresh disk on retry.
  if (input.diskId && !input.diskUuid) fail("DISK_IDENTITY_MISMATCH");
  if (resumePhase(input) === 0) await progress("provisioning", {});
  const diskUuid =
    input.diskUuid ??
    (await ArmWorkflowIO.checkpoint("disk-identity", async () =>
      crypto.randomUUID(),
    ));
  const [diskId, route] = await ArmWorkflowIO.parallel([
    async () =>
      resumePhase(input) > 0 && input.resume?.vmId && input.diskId
        ? input.diskId
        : input.diskId
          ? requireDisk(input.diskId, workspaceId, generation)
          : createDisk(workspaceId),
    async () =>
      resumePhase(input) > 0 && input.resume?.tunnelId && input.resume.routeHost
        ? { tunnelId: input.resume.tunnelId, routeHost: input.resume.routeHost }
        : ensureTunnel(workspaceId, generation).then((tunnel) => ({
            tunnelId: tunnel.id,
            routeHost: tunnel.host,
          })),
  ]);
  return { diskId, diskUuid, route };
}

async function startBakedRuntime(
  input: ArmWorkspaceOperation,
  progress: ArmWorkspaceProgress,
) {
  const { workspaceId, generation } = input;
  const { diskId, diskUuid, route } = await prepareBakedResources(
    input,
    progress,
  );
  const virtualMachineId = await deployBakedVm(
    input,
    progress,
    diskId,
    diskUuid,
    route,
  );
  const resources = {
    vmId: virtualMachineId,
    diskId,
    diskUuid,
    tunnelId: route.tunnelId,
    routeHost: route.routeHost,
  };
  await progress("checking_readiness", resources);
  await waitForHealth(workspaceId, generation, diskUuid, route.routeHost, () =>
    progress("checking_readiness", resources),
  );
  return resources;
}

export class ArmWorkspaceProvider {
  async start(input: ArmWorkspaceOperation, progress: ArmWorkspaceProgress) {
    if (readArmWorkspaceConfig().bootEnabled)
      return startBakedRuntime(input, progress);
    const resources = await prepareRuntime(input, progress);
    return connectRuntime(input, progress, resources);
  }

  async stop(input: ArmWorkspaceOperation) {
    let routeError: unknown;
    try {
      await revokeTunnelRoute(input.workspaceId, input.generation);
    } catch (error) {
      routeError = error;
    }
    const [vm, nic, publicIp, nsg, vnet] = await resourceIds(
      input.workspaceId,
      input.generation,
    );
    await deallocateVm(vm, input.workspaceId, input.generation);
    // A running connector can reconnect immediately after connections cleanup.
    // Deallocate before deleting its tunnel, then finish ephemeral resources.
    try {
      await deleteTunnel(input.workspaceId, input.generation);
      routeError = undefined;
    } catch (error) {
      routeError = error;
    }
    await deleteResource(vm!, COMPUTE_API);
    await deleteResource(nic!, NETWORK_API);
    await deleteResource(publicIp!, NETWORK_API);
    await deleteResource(nsg!, NETWORK_API);
    await deleteResource(vnet!, NETWORK_API);
    if (routeError) throw routeError;
  }

  async deleteDisk(diskId: string | null, workspaceId: string) {
    if (!diskId) return;
    const disk = (await armRequest(
      diskId,
      DISK_API,
      "GET",
      undefined,
      true,
    )) as {
      tags?: Record<string, string>;
      managedBy?: string | null;
      properties?: { diskState?: string };
    } | null;
    if (!disk) return;
    checkTags(disk, workspaceId);
    if (disk.managedBy || disk.properties?.diskState !== "Unattached") {
      fail("DISK_ATTACH_CONFLICT");
    }
    await deleteResource(diskId, DISK_API);
  }

  async healthy(
    workspaceId: string,
    generation: number,
    diskUuid: string,
    routeHost: string | null,
  ) {
    if (!diskUuid || !routeHost) return false;
    try {
      const response = await fetch(`https://${routeHost}/v1/health`, {
        headers: {
          authorization: `Bearer ${await capabilityToken(routeHost, workspaceId, generation)}`,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
      const value = (await response.json().catch(() => null)) as {
        ready?: boolean;
        workspaceId?: string;
        generation?: number;
        diskUuid?: string;
      } | null;
      return Boolean(
        response.ok &&
        value?.ready &&
        value.workspaceId === workspaceId &&
        value.generation === generation &&
        value.diskUuid === diskUuid,
      );
    } catch {
      return false;
    }
  }

  async running(
    workspaceId: string,
    generation: number,
    virtualMachineId: string | null,
  ) {
    return (
      (await this.powerState(workspaceId, generation, virtualMachineId)) ===
      "PowerState/running"
    );
  }

  /** Allocated stopped VMs still incur compute charges until deallocated. */
  async powerState(
    workspaceId: string,
    generation: number,
    virtualMachineId: string | null,
  ) {
    if (!virtualMachineId) return null;
    const vm = (await armRequest(
      `${virtualMachineId}?%24expand=instanceView`,
      COMPUTE_API,
      "GET",
      undefined,
      true,
    )) as {
      tags?: Record<string, string>;
      properties?: { instanceView?: { statuses?: Array<{ code?: string }> } };
    } | null;
    if (!vm) return null;
    checkTags(vm, workspaceId, generation);
    const state = vm.properties?.instanceView?.statuses?.find((status) =>
      status.code?.startsWith("PowerState/"),
    )?.code;
    if (
      !state ||
      ![
        "running",
        "starting",
        "stopping",
        "stopped",
        "deallocating",
        "deallocated",
      ].some((value) => state === `PowerState/${value}`)
    )
      fail("VM_POWER_STATE_UNKNOWN");
    return state;
  }
}
