import { createHash, sign } from "node:crypto";
import { readFile } from "node:fs/promises";

function tunnelName(workspaceId, generation) {
  const opaque = createHash("sha256")
    .update(workspaceId)
    .digest("hex")
    .slice(0, 20);
  return `codev-${opaque}-g${generation}`;
}

function capability(key, host, workspaceId, generation) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const time = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "codev-control-plane",
    aud: host,
    workspaceId,
    generation,
    method: "GET",
    path: "/v1/health",
    scope: "health",
    bodySha256: createHash("sha256").update("").digest("hex"),
    iat: time,
    exp: time + 60,
  };
  const message = `${encode({ alg: "EdDSA", typ: "JWT" })}.${encode(claims)}`;
  return `${message}.${sign(null, Buffer.from(message), key).toString("base64url")}`;
}

export class ArmWorkspaceTunnel {
  constructor({
    accountId,
    zoneId,
    zoneName,
    apiToken,
    signingKeyPath,
    guest,
  }) {
    if (
      ![accountId, zoneId].every((id) => /^[a-f0-9]{32}$/.test(id)) ||
      !apiToken ||
      !signingKeyPath ||
      !/^[a-z0-9.-]+$/.test(zoneName)
    )
      throw new Error("Cloudflare tunnel configuration required");
    Object.assign(this, {
      accountId,
      zoneId,
      zoneName,
      apiToken,
      signingKeyPath,
      guest,
    });
  }

  async request(path, method = "GET", body) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${this.apiToken}`,
          "content-type": "application/json",
        },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );
    const result = await response.json();
    if (!result.success) {
      const error = new Error(`TUNNEL_FAILED_${response.status}`);
      error.code = "TUNNEL_FAILED";
      throw error;
    }
    return result.result;
  }

  async find(workspaceId, generation) {
    const name = tunnelName(workspaceId, generation);
    const tunnels = await this.request(
      `/accounts/${this.accountId}/cfd_tunnel?name=${name}&is_deleted=false`,
    );
    return tunnels.find((tunnel) => tunnel.name === name);
  }

  async ensure(workspaceId, generation, vmId, diskUuid) {
    const name = tunnelName(workspaceId, generation);
    const tunnel =
      (await this.find(workspaceId, generation)) ??
      (await this.request(`/accounts/${this.accountId}/cfd_tunnel`, "POST", {
        name,
        config_src: "cloudflare",
      }));
    const host = `${name}.${this.zoneName}`;
    await this.request(
      `/accounts/${this.accountId}/cfd_tunnel/${tunnel.id}/configurations`,
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
    const dns = await this.request(
      `/zones/${this.zoneId}/dns_records?name=${host}&type=CNAME`,
    );
    const target = `${tunnel.id}.cfargotunnel.com`;
    if (dns.some((record) => record.name === host && record.content !== target))
      throw new Error("TUNNEL_DNS_CONFLICT");
    if (
      !dns.some((record) => record.name === host && record.content === target)
    )
      await this.request(`/zones/${this.zoneId}/dns_records`, "POST", {
        type: "CNAME",
        name: host,
        content: target,
        proxied: true,
        ttl: 1,
      });
    const token = await this.request(
      `/accounts/${this.accountId}/cfd_tunnel/${tunnel.id}/token`,
    );
    await this.guest.install(vmId, {
      workspaceId,
      generation,
      host,
      token,
      diskUuid,
    });
    return { id: tunnel.id, host };
  }

  async health(host, workspaceId, generation, diskUuid) {
    const key = await readFile(this.signingKeyPath);
    for (let attempt = 0; attempt < 36; attempt++) {
      try {
        const response = await fetch(`https://${host}/v1/health`, {
          headers: {
            authorization: `Bearer ${capability(key, host, workspaceId, generation)}`,
          },
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        });
        if (response.ok) {
          const result = await response.json();
          if (
            result.ready &&
            result.workspaceId === workspaceId &&
            result.generation === generation &&
            result.diskUuid === diskUuid
          )
            return { ready: true };
        }
      } catch {
        /* Connector or bridge still starting. */
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    return { ready: false };
  }

  async revokeGeneration(workspaceId, generation) {
    const tunnel = await this.find(workspaceId, generation);
    if (!tunnel) return;
    const host = `${tunnel.name}.${this.zoneName}`;
    const records = await this.request(
      `/zones/${this.zoneId}/dns_records?name=${host}`,
    );
    for (const record of records.filter(
      (item) =>
        item.name === host && item.content === `${tunnel.id}.cfargotunnel.com`,
    )) {
      await this.request(
        `/zones/${this.zoneId}/dns_records/${record.id}`,
        "DELETE",
      );
    }
    await this.request(
      `/accounts/${this.accountId}/cfd_tunnel/${tunnel.id}/connections`,
      "DELETE",
    );
    await this.request(
      `/accounts/${this.accountId}/cfd_tunnel/${tunnel.id}`,
      "DELETE",
    );
  }
}
