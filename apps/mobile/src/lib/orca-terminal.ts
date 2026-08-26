import type {
  RuntimeTerminalCreate,
  RuntimeTerminalListResult,
} from "@/vendor/orca/src/shared/runtime-types";
import type { RpcClient } from "@/vendor/orca/mobile/src/transport/rpc-client";

export class OrcaTerminalError extends Error {}

async function call<T>(client: RpcClient, method: string, params?: unknown): Promise<T> {
  const response = await client.sendRequest(method, params);
  if (!response.ok) {
    throw new OrcaTerminalError(response.error.message);
  }
  return response.result as T;
}

/** Reuses the workspace's existing terminal if one is live, otherwise creates one. */
export async function ensureOrcaTerminal(client: RpcClient): Promise<string> {
  const list = await call<RuntimeTerminalListResult>(client, "terminal.list", {});
  const existing = list.terminals[0];
  if (existing) {
    return existing.handle;
  }
  const created = await call<{ terminal: RuntimeTerminalCreate }>(client, "terminal.create", {});
  return created.terminal.handle;
}

export type OrcaTerminalStreamEvent =
  | { type: "subscribed"; streamId: number | null; lines?: string[]; truncated?: boolean }
  | { type: "data"; streamId: number; chunk: string }
  | { type: "scrollback" | "resized"; streamId: number; serialized: string; cols?: number; rows?: number }
  | { type: "metadata"; streamId: number }
  | { type: "end" }
  | { type: "error"; streamId: number; message: string };

export function subscribeOrcaTerminal(
  client: RpcClient,
  terminal: string,
  clientId: string,
  viewport: { cols: number; rows: number },
  onEvent: (event: OrcaTerminalStreamEvent) => void,
): () => void {
  return client.subscribe(
    "terminal.subscribe",
    {
      terminal,
      client: { id: clientId, type: "mobile" },
      viewport,
      capabilities: { terminalBinaryStream: 1 },
    },
    (result) => onEvent(result as OrcaTerminalStreamEvent),
  );
}

export function sendOrcaTerminalInput(
  client: RpcClient,
  terminal: string,
  clientId: string,
  text: string,
  enter: boolean,
): Promise<void> {
  return call(client, "terminal.send", {
    terminal,
    text,
    enter,
    client: { id: clientId, type: "mobile" },
  });
}
