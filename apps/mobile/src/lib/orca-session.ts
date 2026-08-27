import { openOrcaSession } from "@/lib/api-client";
import { parsePairingCode } from "@/vendor/orca/mobile/src/transport/pairing";
import {
  connect,
  type ConnectOptions,
  type RpcClient,
} from "@/vendor/orca/mobile/src/transport/rpc-client";

export class OrcaSessionError extends Error {}

/**
 * Fetches this workspace's pairing offer from CoDev's backend and connects
 * the vendored Orca RPC client directly to it, skipping Orca Mobile's own
 * QR-scan pairing screens entirely — CoDev's backend already holds the offer
 * for the workspace's own `orca serve` runtime.
 */
export async function connectOrcaWorkspace(
  workspaceId: string,
  options?: ConnectOptions,
): Promise<{ state: "host-starting" } | { state: "ready"; client: RpcClient }> {
  const result = await openOrcaSession(workspaceId);
  if (result.state === "host-starting") {
    return { state: "host-starting" };
  }
  const offer = parsePairingCode(result.pairingCode);
  if (!offer) {
    throw new OrcaSessionError(
      "Could not decode this workspace's pairing offer.",
    );
  }
  const client = connect(
    offer.endpoint,
    offer.deviceToken,
    offer.publicKeyB64,
    options,
  );
  return { state: "ready", client };
}
