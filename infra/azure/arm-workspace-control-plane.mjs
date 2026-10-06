export class ArmWorkspaceControlPlane {
  constructor({ url, secret, fetchImpl = fetch }) {
    if (!url || !secret) throw new Error("ARM_CONTROL_PLANE_CONFIG_REQUIRED");
    this.url = new URL("/api/gen2/agents/checkpoint", url).toString();
    this.secret = secret;
    this.fetch = fetchImpl;
  }

  async checkpointCredentials(workspaceId) {
    const response = await this.fetch(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workspaceId }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("CREDENTIAL_CHECKPOINT_FAILED");
    const result = await response.json();
    if (!Number.isInteger(result?.checkpointed) || result.checkpointed < 0)
      throw new Error("CREDENTIAL_CHECKPOINT_INVALID_RESPONSE");
    return result;
  }
}
