const WORKSPACE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function theiaWorkspaceUrl(workspaceId: string) {
  if (!WORKSPACE_ID.test(workspaceId)) {
    throw new Error("Invalid workspace ID.");
  }
  return `/theia/index.html?workspaceId=${workspaceId}`;
}

export function theiaSocketProxyPath(search: string) {
  return `/socket.io/${search.startsWith("?") ? search : ""}`;
}

export function scopeTheiaConnectionCookie(
  cookie: string,
  workspaceId: string,
) {
  if (!WORKSPACE_ID.test(workspaceId)) {
    throw new Error("Invalid workspace ID.");
  }
  return cookie.replace(
    /;\s*Path=\/(?=;|$)/i,
    `; Path=/api/workspaces/${workspaceId}/theia`,
  );
}
