import "server-only";

import type {
  GitHubPickerAccount,
  GitHubPickerRepository,
} from "@codev/contracts";
import {
  GitHubApiError,
  githubRequest,
  listGitHubInstallations,
  listRepositories,
} from "./github";

// The authenticated GitHub identity is authoritative, including after a rename.
async function pickerContext(userId: string) {
  const [identity, installations] = await Promise.all([
    githubRequest<{ login: string; avatar_url: string }>(userId, "/user"),
    listGitHubInstallations(userId),
  ]);
  return { identity, installations };
}

export async function listPickerAccounts(
  userId: string,
): Promise<GitHubPickerAccount[]> {
  const { identity, installations } = await pickerContext(userId);
  const personal = installations.find(
    (item) =>
      item.account.type === "User" &&
      item.account.login.toLowerCase() === identity.login.toLowerCase(),
  );
  return [
    { id: personal?.id ?? 0, account: { ...identity, type: "User" } },
    ...installations.filter((item) => item.account.type === "Organization"),
  ];
}

async function collaborationNames(
  userId: string,
  fullName: string,
  login: string,
) {
  const owner = fullName.split("/")[0]!;
  try {
    const collaborators = await githubRequest<{ login: string }[]>(
      userId,
      `/repos/${fullName}/collaborators?per_page=100`,
    );
    return [
      ...new Set([owner, ...collaborators.map((person) => person.login)]),
    ].filter((name) => name.toLowerCase() !== login.toLowerCase());
  } catch (error) {
    // A reader can clone a shared repository without permission to list members.
    if (error instanceof GitHubApiError && [403, 404].includes(error.status))
      return owner.toLowerCase() === login.toLowerCase() ? [] : [owner];
    throw error;
  }
}

export async function listPickerRepositories(
  userId: string,
  accountId: number,
): Promise<GitHubPickerRepository[]> {
  const { identity, installations } = await pickerContext(userId);
  const personalId =
    installations.find(
      (item) =>
        item.account.type === "User" &&
        item.account.login.toLowerCase() === identity.login.toLowerCase(),
    )?.id ?? 0;
  const sources = installations.filter((item) =>
    accountId === personalId
      ? item.account.type === "User"
      : item.id === accountId && item.account.type === "Organization",
  );
  if (accountId !== personalId && sources.length === 0)
    throw new Error("Invalid GitHub account.");
  const results = await Promise.all(
    sources.map(async (installation) => {
      const repositories = await listRepositories(userId, installation.id);
      return Promise.all(
        repositories.map(async (repository) => ({
          id: repository.id,
          full_name: repository.full_name,
          private: repository.private,
          default_branch: repository.default_branch,
          installationId: installation.id,
          ...(accountId === personalId
            ? {
                sharedWith: await collaborationNames(
                  userId,
                  repository.full_name,
                  identity.login,
                ),
              }
            : {}),
        })),
      );
    }),
  );
  return [...new Map(results.flat().map((repo) => [repo.id, repo])).values()];
}
