export const BINARY_OMITTED_DETAIL = "Binary file · content omitted";
export const BINARY_SAFE_NOTE =
  "Binary content is not rendered as text; review remains safe for binary and generated files.";

export type ReviewDiffPathKind = "added" | "deleted" | "modified" | "binary";

export type ReviewDiffPath = {
  path: string;
  kind: ReviewDiffPathKind;
  detail: string;
};

export type ReviewDiffSummary = {
  summary: string;
  additions: number;
  deletions: number;
  paths: ReviewDiffPath[];
};

export const EMPTY_REVIEW_DIFF_SUMMARY: ReviewDiffSummary = {
  summary: "0 paths changed · 0 text files · 0 binary files",
  additions: 0,
  deletions: 0,
  paths: [],
};

const GIT_DIFF_HEADER = /^diff --git a\/(.+?) b\/(.+)$/m;
const BINARY_MARKERS = /^(?:GIT binary patch|Binary files |Binary file )/m;

function countLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function formatReviewDiffSummary(
  textFiles: number,
  binaryFiles: number,
) {
  return `${countLabel(textFiles + binaryFiles, "path")} changed · ${countLabel(textFiles, "text file")} · ${countLabel(binaryFiles, "binary file")}`;
}

export function formatLineDelta(additions: number, deletions: number) {
  const unit = additions + deletions === 1 ? "line" : "lines";
  return `+${additions} −${deletions} ${unit}`;
}

function splitGitDiffFiles(diff: string) {
  return diff
    .split(/(?=^diff --git )/m)
    .map((block) => block.trimEnd())
    .filter((block) => block.startsWith("diff --git "));
}

function pathFromDiffBlock(block: string) {
  const header = GIT_DIFF_HEADER.exec(block);
  const quoted = header?.[2]?.replace(/^"(.*)"$/, "$1");
  return quoted?.replace(/\\n/g, "\n") || "unknown";
}

function countTextDelta(block: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of block.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function parseDiffBlock(block: string): ReviewDiffPath & {
  additions: number;
  deletions: number;
} {
  const path = pathFromDiffBlock(block);
  if (BINARY_MARKERS.test(block)) {
    return {
      path,
      kind: "binary",
      detail: BINARY_OMITTED_DETAIL,
      additions: 0,
      deletions: 0,
    };
  }
  const { additions, deletions } = countTextDelta(block);
  const kind: ReviewDiffPathKind = /^new file mode /m.test(block)
    ? "added"
    : /^deleted file mode /m.test(block)
      ? "deleted"
      : "modified";
  return {
    path,
    kind,
    detail: formatLineDelta(additions, deletions),
    additions,
    deletions,
  };
}

export function summarizeReviewDiff(diff: string): ReviewDiffSummary {
  if (!diff.trim()) return EMPTY_REVIEW_DIFF_SUMMARY;
  const parsed = splitGitDiffFiles(diff).map(parseDiffBlock);
  if (parsed.length === 0) return EMPTY_REVIEW_DIFF_SUMMARY;
  const paths: ReviewDiffPath[] = parsed.map(({ path, kind, detail }) => ({
    path,
    kind,
    detail,
  }));
  const textFiles = paths.filter((entry) => entry.kind !== "binary").length;
  const binaryFiles = paths.length - textFiles;
  const additions = parsed.reduce((sum, entry) => sum + entry.additions, 0);
  const deletions = parsed.reduce((sum, entry) => sum + entry.deletions, 0);
  return {
    summary: formatReviewDiffSummary(textFiles, binaryFiles),
    additions,
    deletions,
    paths,
  };
}
