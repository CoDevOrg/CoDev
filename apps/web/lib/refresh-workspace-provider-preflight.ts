import {
  workspaceProviderPreflight,
  type WorkspaceProviderPreflight,
} from "@/lib/provider-surface-capability";
import type { ProviderConnectionSnapshot } from "@/lib/provider-connection-view";

export function workspaceProviderPreflightFromPayload(
  payload: unknown,
): WorkspaceProviderPreflight | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const snapshot = payload as ProviderConnectionSnapshot;
  if (
    !Array.isArray(snapshot.connections) ||
    !Array.isArray(snapshot.cliSubscriptions) ||
    !snapshot.claudeCliToken ||
    typeof snapshot.claudeCliToken !== "object"
  ) {
    return null;
  }
  return workspaceProviderPreflight(snapshot);
}

/** Re-read the member's connections after they connect from inside the IDE. */
export async function refreshWorkspaceProviderPreflight(
  fetchImpl: typeof fetch = fetch,
): Promise<WorkspaceProviderPreflight | null> {
  try {
    const response = await fetchImpl("/api/personal/connections", {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      return null;
    }
    return workspaceProviderPreflightFromPayload(await response.json());
  } catch {
    return null;
  }
}
