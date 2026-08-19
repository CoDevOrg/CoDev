import "server-only";

import { Octokit } from "@octokit/rest";
import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { decryptSecret, encryptSecret } from "./crypto";
import { getDatabase } from "./database";

const GITHUB_API_VERSION = "2026-03-10";

export interface GitHubInstallation {
  id: number;
  account: {
    login: string;
    avatar_url: string;
    type: "Organization" | "User";
  };
  repository_selection: "all" | "selected";
}

export interface GitHubRepository {
  id: number;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  archived: boolean;
  owner: {
    login: string;
    avatar_url: string;
  };
}

interface GitHubConnection {
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
}

async function refreshGitHubToken(
  userId: string,
  connection: GitHubConnection,
) {
  if (!connection.encryptedRefreshToken) {
    throw new Error("GitHub authorization expired. Sign in again.");
  }

  const clientId = process.env.AUTH_GITHUB_ID;
  const clientSecret = process.env.AUTH_GITHUB_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GitHub authentication is not configured.");
  }

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: await decryptSecret(connection.encryptedRefreshToken),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("GitHub authorization could not be refreshed.");
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
  };
  if (!payload.access_token) {
    throw new Error("GitHub did not return a refreshed access token.");
  }

  const now = Date.now();
  await getDatabase()
    .update(schema.githubConnections)
    .set({
      encryptedAccessToken: await encryptSecret(payload.access_token),
      encryptedRefreshToken: payload.refresh_token
        ? await encryptSecret(payload.refresh_token)
        : connection.encryptedRefreshToken,
      accessTokenExpiresAt: payload.expires_in
        ? new Date(now + payload.expires_in * 1000)
        : null,
      refreshTokenExpiresAt: payload.refresh_token_expires_in
        ? new Date(now + payload.refresh_token_expires_in * 1000)
        : connection.refreshTokenExpiresAt,
      keyVersion: 2,
      updatedAt: new Date(),
    })
    .where(eq(schema.githubConnections.userId, userId));

  return payload.access_token;
}

/**
 * A member's GitHub connection is "connected" only when both the primary
 * sign-in link (`users.githubUserId`) and the linked-account token row
 * (`github_connections`) exist — matching how a GitHub identity is either
 * the account's original sign-in method or a secondary account linked
 * later via "Connect GitHub". Any caller that needs to know whether GitHub
 * is connected (not just fetch a usable token) should use this rather than
 * inlining its own check, since the two tables can disagree.
 */
export async function resolveGithubConnection(
  userId: string,
): Promise<{ connected: boolean; login: string | null }> {
  const [record] = await getDatabase()
    .select({
      githubUserId: schema.users.githubUserId,
      login: schema.users.login,
      connectionUserId: schema.githubConnections.userId,
    })
    .from(schema.users)
    .leftJoin(
      schema.githubConnections,
      eq(schema.githubConnections.userId, schema.users.id),
    )
    .where(eq(schema.users.id, userId))
    .limit(1);

  const connected = Boolean(
    record?.githubUserId !== null && record?.connectionUserId,
  );
  return { connected, login: connected ? (record?.login ?? null) : null };
}

export async function getGitHubUserToken(userId: string) {
  const [connection] = await getDatabase()
    .select()
    .from(schema.githubConnections)
    .where(eq(schema.githubConnections.userId, userId))
    .limit(1);

  if (!connection) {
    throw new Error("Connect GitHub before opening a repository.");
  }

  if (
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() <= Date.now() + 60_000
  ) {
    return refreshGitHubToken(userId, connection);
  }

  return decryptSecret(connection.encryptedAccessToken);
}

export async function getGitHubOctokit(userId: string) {
  const token = await getGitHubUserToken(userId);
  return new Octokit({
    auth: token,
    userAgent: "CoDev",
    request: { timeout: 30_000 },
  });
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export async function githubRequest<T>(
  userId: string,
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
): Promise<T> {
  const token = await getGitHubUserToken(userId);
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "CoDev",
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new GitHubApiError(
        "GitHub authorization is no longer valid. Sign in again.",
        response.status,
      );
    }
    if (response.status === 403) {
      throw new GitHubApiError(
        "The CoDev GitHub App needs Contents: Read and write and Pull requests: Read and write before it can publish or open pull requests.",
        response.status,
      );
    }
    throw new GitHubApiError(
      `GitHub request failed with status ${response.status}.`,
      response.status,
    );
  }

  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

export async function listGitHubInstallations(userId: string) {
  const payload = await githubRequest<{ installations: GitHubInstallation[] }>(
    userId,
    "/user/installations?per_page=100",
  );
  return payload.installations;
}

export async function listRepositories(userId: string, installationId: number) {
  const payload = await githubRequest<{ repositories: GitHubRepository[] }>(
    userId,
    `/user/installations/${installationId}/repositories?per_page=100`,
  );
  return payload.repositories.filter((repository) => !repository.archived);
}

export async function getRepository(
  userId: string,
  installationId: number,
  repositoryId: number,
) {
  const repositories = await listRepositories(userId, installationId);
  const repository = repositories.find(
    (candidate) => candidate.id === repositoryId,
  );
  if (!repository) {
    throw new Error(
      "That repository is not available to this GitHub App installation.",
    );
  }

  const commit = await githubRequest<{ sha: string }>(
    userId,
    `/repos/${repository.full_name}/commits/${encodeURIComponent(repository.default_branch)}`,
  );
  return { repository, baseSha: commit.sha };
}

export interface RepositorySnapshotFile {
  path: string;
  mode: "100644" | "100755" | "120000";
  contentBase64: string;
}

export interface RepositorySnapshot {
  files: RepositorySnapshotFile[];
  totalBytes: number;
}

export async function getRepositorySnapshot(
  userId: string,
  repository: string,
  commitSha: string,
): Promise<RepositorySnapshot> {
  const tree = await githubRequest<{
    truncated: boolean;
    tree: {
      path: string;
      mode: string;
      type: "blob" | "tree" | "commit";
      sha: string;
      size?: number;
    }[];
  }>(
    userId,
    `/repos/${repository}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`,
  );
  if (tree.truncated) {
    throw new Error("The repository tree is too large for a CoDev snapshot.");
  }

  const blobs = tree.tree.filter((entry) => entry.type === "blob");
  if (tree.tree.some((entry) => entry.type === "commit")) {
    throw new Error("Private repository snapshots do not support submodules.");
  }
  if (blobs.length > 500) {
    throw new Error("Private repository snapshots are limited to 500 files.");
  }
  const declaredBytes = blobs.reduce(
    (total, entry) => total + (entry.size ?? 0),
    0,
  );
  if (declaredBytes > 3 * 1_024 * 1_024) {
    throw new Error("Private repository snapshots are limited to 3 MiB.");
  }

  const files: RepositorySnapshotFile[] = [];
  let totalBytes = 0;
  for (let offset = 0; offset < blobs.length; offset += 10) {
    const batch = blobs.slice(offset, offset + 10);
    const contents = await Promise.all(
      batch.map((entry) =>
        githubRequest<{ content: string; encoding: string }>(
          userId,
          `/repos/${repository}/git/blobs/${entry.sha}`,
        ),
      ),
    );
    for (const [index, entry] of batch.entries()) {
      const blob = contents[index];
      if (!blob || blob.encoding !== "base64") {
        throw new Error("GitHub returned an unsupported repository blob.");
      }
      if (!["100644", "100755", "120000"].includes(entry.mode)) {
        throw new Error(`Unsupported Git mode for ${entry.path}.`);
      }
      const contentBase64 = blob.content.replace(/\s+/g, "");
      const byteLength = Buffer.from(contentBase64, "base64").byteLength;
      totalBytes += byteLength;
      if (byteLength > 1 * 1_024 * 1_024) {
        throw new Error(`Private repository file ${entry.path} exceeds 1 MiB.`);
      }
      if (totalBytes > 3 * 1_024 * 1_024) {
        throw new Error("Private repository snapshots are limited to 3 MiB.");
      }
      files.push({
        path: entry.path,
        mode: entry.mode as RepositorySnapshotFile["mode"],
        contentBase64,
      });
    }
  }
  return { files, totalBytes };
}
