import type {
  ChannelMessage,
  ChannelSummary,
  CreateChannelInput,
  MemberStatusInput,
  TeamRoster,
} from "@codev/contracts";

export type AgentDispatchResult =
  | { dispatched: true; sessionId: string }
  | { dispatched: false; reason: string }
  | null;

async function readJson(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "The request could not be completed.");
  }
  return payload as Record<string, unknown>;
}

export async function fetchTeamRoster(
  workspaceId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/workspaces/${workspaceId}/team`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  return (await readJson(response)) as unknown as TeamRoster;
}

export async function saveMemberStatus(
  workspaceId: string,
  input: MemberStatusInput,
) {
  const response = await fetch(`/api/workspaces/${workspaceId}/team`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await readJson(response)) as unknown as MemberStatusInput;
}

export async function fetchChannels(workspaceId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/workspaces/${workspaceId}/channels`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  const payload = await readJson(response);
  return (payload.channels ?? []) as ChannelSummary[];
}

export async function createChannel(
  workspaceId: string,
  input: CreateChannelInput,
) {
  const response = await fetch(`/api/workspaces/${workspaceId}/channels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await readJson(response);
  return payload.channel as { id: string; slug: string };
}

export async function fetchChannelMessages(
  workspaceId: string,
  channelId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/workspaces/${workspaceId}/channels/${channelId}/messages`,
    { cache: "no-store", ...(signal ? { signal } : {}) },
  );
  const payload = await readJson(response);
  return (payload.messages ?? []) as ChannelMessage[];
}

export async function sendChannelMessage(
  workspaceId: string,
  channelId: string,
  body: string,
) {
  const response = await fetch(
    `/api/workspaces/${workspaceId}/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
  const payload = await readJson(response);
  return {
    message: payload.message as ChannelMessage,
    agentDispatch: (payload.agentDispatch ?? null) as AgentDispatchResult,
  };
}
