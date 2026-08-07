const WORKSPACE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function workspaceIdFromSearch(search: string): string | undefined {
  const value = new URLSearchParams(search).get("workspaceId");
  return value && WORKSPACE_ID.test(value) ? value : undefined;
}

export function workspaceAgentsPath(workspaceId: string): string {
  if (!WORKSPACE_ID.test(workspaceId)) {
    throw new Error("Invalid workspace ID.");
  }
  return `/workspaces/${workspaceId}/agents`;
}

export async function workspaceStartupError(
  response: Response,
): Promise<string | undefined> {
  if (response.ok) return undefined;

  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error ?? `Workspace startup failed (${response.status}).`;
}
