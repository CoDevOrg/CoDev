import "server-only";

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
      refresh_token: decryptSecret(connection.encryptedRefreshToken),
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
      encryptedAccessToken: encryptSecret(payload.access_token),
      encryptedRefreshToken: payload.refresh_token
        ? encryptSecret(payload.refresh_token)
        : connection.encryptedRefreshToken,
      accessTokenExpiresAt: payload.expires_in
        ? new Date(now + payload.expires_in * 1000)
        : null,
      refreshTokenExpiresAt: payload.refresh_token_expires_in
        ? new Date(now + payload.refresh_token_expires_in * 1000)
        : connection.refreshTokenExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.githubConnections.userId, userId));

  return payload.access_token;
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

async function githubRequest<T>(userId: string, path: string): Promise<T> {
  const token = await getGitHubUserToken(userId);
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "CoDev",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "GitHub authorization is no longer valid. Sign in again.",
      );
    }
    throw new Error(`GitHub request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

export async function listGitHubInstallations(userId: string) {
  const payload = await githubRequest<{ installations: GitHubInstallation[] }>(
    userId,
    "/user/installations?per_page=100",
  );
  return payload.installations;
}

export async function listPublicRepositories(
  userId: string,
  installationId: number,
) {
  const payload = await githubRequest<{ repositories: GitHubRepository[] }>(
    userId,
    `/user/installations/${installationId}/repositories?per_page=100`,
  );
  return payload.repositories.filter(
    (repository) => !repository.private && !repository.archived,
  );
}

export async function getPublicRepository(
  userId: string,
  installationId: number,
  repositoryId: number,
) {
  const repositories = await listPublicRepositories(userId, installationId);
  const repository = repositories.find(
    (candidate) => candidate.id === repositoryId,
  );
  if (!repository) {
    throw new Error(
      "That public repository is not available to this installation.",
    );
  }

  const commit = await githubRequest<{ sha: string }>(
    userId,
    `/repos/${repository.full_name}/commits/${encodeURIComponent(repository.default_branch)}`,
  );
  return { repository, baseSha: commit.sha };
}
