import { getStoredToken } from "@/lib/auth";
import { API_BASE_URL } from "@/lib/config";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getStoredToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new ApiError(
      body?.error ?? `Request failed with status ${response.status}.`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export type WorkspaceSummary = {
  id: string;
  repository: string | null;
  repositoryVisibility: string | null;
  defaultBranch: string | null;
  baseSha: string | null;
  status:
    | "pending"
    | "provisioning"
    | "ready"
    | "hibernated"
    | "stopping"
    | "stopped"
    | "failed";
  role: string;
  accessRole: "owner" | "co_steer" | "reviewer" | "viewer";
  updatedAt: string;
};

export type AgentSessionStatus =
  | "idle"
  | "running"
  | "waiting"
  | "completed"
  | "interrupted"
  | "failed";

export type AgentSessionSummary = {
  id: string;
  workspaceId: string;
  name: string;
  model: string;
  provider: string;
  status: AgentSessionStatus;
  lastError: string | null;
  createdAt: string;
};

export type ActivityEvent = {
  id: string;
  sequence: number;
  type: string;
  actor: string;
  summary: string;
  createdAt: string;
  path: string | null;
  sessionId: string | null;
};

export type AttentionItem = {
  workspaceId: string;
  sessionId: string;
  sessionName: string;
  status: AgentSessionStatus;
  lastError: string | null;
  updatedAt: string;
  repository: string | null;
};

export function listWorkspaces() {
  return request<{ workspaces: WorkspaceSummary[] }>("/api/workspaces");
}

export type GitHubInstallation = {
  id: number;
  account: {
    login: string;
    avatar_url: string;
    type: "Organization" | "User";
  };
  repository_selection: "all" | "selected";
};

export type GitHubRepository = {
  id: number;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  archived: boolean;
  owner: { login: string; avatar_url: string };
};

export function listGitHubInstallations() {
  return request<{ installations: GitHubInstallation[] }>(
    "/api/github/installations",
  );
}

export function listInstallationRepositories(installationId: number) {
  return request<{ repositories: GitHubRepository[] }>(
    `/api/github/installations/${installationId}/repositories`,
  );
}

export function createWorkspace(
  input: { installationId: number; repositoryId: number } | Record<string, never> = {},
) {
  return request<{ workspace: { id: string } }>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getWorkspace(workspaceId: string) {
  return request<{ workspace: WorkspaceSummary & { ownerId: string } }>(
    `/api/workspaces/${workspaceId}`,
  );
}

export function listAgentSessions(workspaceId: string) {
  return request<{ sessions: AgentSessionSummary[] }>(
    `/api/workspaces/${workspaceId}/agents`,
  );
}

export function createAgentSession(
  workspaceId: string,
  input: { name: string; prompt: string },
) {
  return request<{ sessionId: string; worktreeId: string }>(
    `/api/workspaces/${workspaceId}/agents`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/**
 * The events endpoint's `kind`/`query` filters target its own jump-target
 * taxonomy ("file" | "session" | "diff" link kind, plus a free-text search),
 * not a specific session's id — so we fetch the workspace's full event list
 * and filter client-side by each event's `sessionId` field instead.
 */
export async function listActivityEvents(
  workspaceId: string,
  sessionId: string,
) {
  const { events } = await request<{ events: ActivityEvent[] }>(
    `/api/workspaces/${workspaceId}/events`,
  );
  return events.filter((event) => event.sessionId === sessionId);
}

export function sendAgentTurn(
  workspaceId: string,
  sessionId: string,
  prompt: string,
) {
  return request<{ turnId: string }>(
    `/api/workspaces/${workspaceId}/agents/${sessionId}/turns`,
    { method: "POST", body: JSON.stringify({ prompt }) },
  );
}

export function interruptAgentSession(workspaceId: string, sessionId: string) {
  return request(
    `/api/workspaces/${workspaceId}/agents/${sessionId}/interrupt`,
    { method: "POST" },
  );
}

export type OrcaSessionResult =
  | { state: "host-starting" }
  | {
      state: "ready";
      pairingCode: string;
      endpoint: string;
      runtimeId: string;
      workspacePath: string;
      webClientPath: string;
    };

export function openOrcaSession(workspaceId: string) {
  return request<OrcaSessionResult>(`/api/workspaces/${workspaceId}/orca`, {
    method: "POST",
  });
}

export function listAttentionItems() {
  return request<{ items: AttentionItem[] }>("/api/mobile/attention");
}

export function registerPushToken(input: {
  expoPushToken: string;
  platform: "ios" | "android";
  deviceId?: string;
}) {
  return request("/api/mobile/push-token", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function unregisterPushToken(expoPushToken: string) {
  return request("/api/mobile/push-token", {
    method: "DELETE",
    body: JSON.stringify({ expoPushToken }),
  });
}
