const version = "2023-11-03";

function workspaceName(id) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error("INVALID_WORKSPACE_ID");
  return `${id}.json`;
}

export class ArmWorkspaceBlobState {
  constructor(account, token, container = "arm-workspace-state") {
    if (!/^[a-z0-9]{3,24}$/.test(account) || !token)
      throw new Error("Azure Blob credentials required");
    this.account = account;
    this.token = token;
    this.container = container;
  }

  async request(id, method, query = "", headers = {}, body) {
    const response = await fetch(
      `https://${this.account}.blob.core.windows.net/${this.container}/${workspaceName(id)}${query}`,
      {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          "x-ms-version": version,
          "x-ms-date": new Date().toUTCString(),
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );
    if (!response.ok && ![404, 409, 412].includes(response.status))
      throw new Error(`STORAGE_UNAVAILABLE_${response.status}`);
    return response;
  }

  async initialize(id) {
    const body = JSON.stringify({
      workspaceId: id,
      status: "stopped",
      generation: 0,
      dataDiskId: null,
      diskUuid: null,
      operation: null,
    });
    const response = await this.request(
      id,
      "PUT",
      "",
      {
        "x-ms-blob-type": "BlockBlob",
        "content-type": "application/json",
        "if-none-match": "*",
      },
      body,
    );
    if (![201, 409, 412].includes(response.status))
      throw new Error(`STORAGE_INITIALIZE_FAILED_${response.status}`);
  }

  async acquire(id) {
    const response = await this.request(id, "PUT", "?comp=lease", {
      "x-ms-lease-action": "acquire",
      "x-ms-lease-duration": "60",
    });
    if (response.status === 409 || response.status === 412)
      throw new Error("WORKSPACE_BUSY");
    if (response.status !== 201) throw new Error("STORAGE_LEASE_FAILED");
    return response.headers.get("x-ms-lease-id");
  }

  async renew(id, leaseId) {
    const response = await this.request(id, "PUT", "?comp=lease", {
      "x-ms-lease-action": "renew",
      "x-ms-lease-id": leaseId,
    });
    if (response.status !== 200) throw new Error("LEASE_LOST");
  }

  async release(id, leaseId) {
    const response = await this.request(id, "PUT", "?comp=lease", {
      "x-ms-lease-action": "release",
      "x-ms-lease-id": leaseId,
    });
    if (response.status !== 200) throw new Error("LEASE_LOST");
  }

  async read(id) {
    const response = await this.request(id, "GET");
    if (response.status !== 200) throw new Error("STATE_MISSING");
    return { state: await response.json(), etag: response.headers.get("etag") };
  }

  async write(id, leaseId, etag, state) {
    const response = await this.request(
      id,
      "PUT",
      "",
      {
        "x-ms-blob-type": "BlockBlob",
        "content-type": "application/json",
        "x-ms-lease-id": leaseId,
        "if-match": etag,
      },
      JSON.stringify(state),
    );
    if (response.status !== 201) throw new Error("STALE_OPERATION");
    return response.headers.get("etag");
  }
}
