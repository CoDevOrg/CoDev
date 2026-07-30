export function hasUnpublishedRuntimeChanges(
  integrationHeadSha: string,
  provisionedHeadSha: string | null,
  repositoryBaseSha: string,
) {
  return integrationHeadSha !== (provisionedHeadSha ?? repositoryBaseSha);
}
