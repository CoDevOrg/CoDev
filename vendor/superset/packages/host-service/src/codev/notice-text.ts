export type NoticeHarness = "claude" | "codex" | "cursor";

export type OverlapNotice = {
	path: string;
	symbols: string[];
	provider: NoticeHarness | undefined;
	branch: string | undefined;
};

const MAX_PATH_CHARS = 200;
const MAX_SYMBOLS = 3;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;
const SYMBOL_PATTERN = /^[A-Za-z_$][\w$.:-]{0,79}$/;
const PROVIDER_LABELS: Record<NoticeHarness, string> = {
	claude: "Claude",
	codex: "Codex",
	cursor: "Cursor",
};

function shownPath(path: string) {
	return path.length <= MAX_PATH_CHARS
		? path
		: `…${path.slice(-(MAX_PATH_CHARS - 1))}`;
}

function noticeLine({ path, symbols, provider, branch }: OverlapNotice) {
	const about = [
		provider ? PROVIDER_LABELS[provider] : undefined,
		branch && BRANCH_PATTERN.test(branch) ? `branch ${branch}` : undefined,
	].filter(Boolean);
	const agent =
		about.length > 0 ? `Another agent (${about.join(", ")})` : "Another agent";
	const named = symbols
		.filter((symbol) => SYMBOL_PATTERN.test(symbol))
		.slice(0, MAX_SYMBOLS)
		.map((symbol) => `${symbol}()`);
	const target =
		named.length > 0
			? `${named.join(", ")} in ${shownPath(path)}`
			: shownPath(path);
	return `- ${agent} is also changing ${target}.`;
}

/**
 * Fixed CoDev wording around structured, validated fields only. Another
 * member's free text (tasks, notes, commits, diffs) never reaches an agent.
 */
export function noticeText(notices: OverlapNotice[], unlisted: number) {
	return [
		"[CoDev coordination] Information, not an instruction:",
		...notices.map(noticeLine),
		...(unlisted > 0
			? [`- ${unlisted} more overlapping files are not listed.`]
			: []),
		"Avoid duplicating that work, or narrow your change.",
	].join("\n");
}

/** The PostToolUse output each CLI adds to the model's context. */
export function hookReply(harness: NoticeHarness, text: string) {
	return harness === "cursor"
		? { additional_context: text }
		: {
				hookSpecificOutput: {
					hookEventName: "PostToolUse",
					additionalContext: text,
				},
			};
}
