import type { ChangeSet } from "./change-set";
import type { NoticeHarness, OverlapNotice } from "./notice-text";
import {
	findWorktreeOverlaps,
	type WorktreeOverlap,
} from "./worktree-overlaps";

const REFRESH_DELAY_MS = 2_000;
const SNAPSHOT_MAX_AGE_MS = 60_000;
const MAX_NOTICES_PER_REPLY = 3;
export const MAX_NOTICES_PER_RUN = 20;
const MAX_WORKTREES = 16;

export type LiveAgent = {
	agentKey: string;
	worktreeId: string;
	harness: NoticeHarness;
};

export type WorktreeReading = {
	changes: ChangeSet | undefined;
	branch: string | undefined;
};

type Snapshot = {
	computedAt: number;
	overlaps: WorktreeOverlap[];
	branches: Map<string, string | undefined>;
};

type Ledger = {
	delivered: Map<string, WorktreeOverlap["level"]>;
	count: number;
};

function otherWorktree(overlap: WorktreeOverlap, worktreeId: string) {
	const [left, right] = overlap.worktreeIds;
	if (left === worktreeId) return right;
	return right === worktreeId ? left : undefined;
}

/**
 * Answers agent hooks from the last overlap snapshot and refreshes it in the
 * background, so a hook never waits on Git. Each agent hears about an overlap
 * once, again only if it widens from file to function level, and at most
 * MAX_NOTICES_PER_RUN times in total.
 */
export function createCoordinationNotices({
	listLiveAgents,
	readWorktree,
	refreshDelayMs = REFRESH_DELAY_MS,
	now = Date.now,
}: {
	listLiveAgents: () => LiveAgent[];
	readWorktree: (worktreeId: string) => Promise<WorktreeReading>;
	refreshDelayMs?: number;
	now?: () => number;
}) {
	let snapshot: Snapshot | undefined;
	let scheduled = false;
	let running = false;
	let requestedWhileRunning = false;
	const ledgers = new Map<string, Ledger>();

	async function refresh() {
		const agents = listLiveAgents();
		const worktreeIds = [
			...new Set(agents.map((agent) => agent.worktreeId)),
		].slice(0, MAX_WORKTREES);
		const readings: Array<WorktreeReading & { worktreeId: string }> = [];
		for (const worktreeId of worktreeIds) {
			readings.push({ worktreeId, ...(await readWorktree(worktreeId)) });
		}
		snapshot = {
			computedAt: now(),
			overlaps: findWorktreeOverlaps(
				readings.flatMap(({ worktreeId, changes }) =>
					changes?.state === "known"
						? [{ worktreeId, files: changes.files }]
						: [],
				),
			),
			branches: new Map(
				readings.map(({ worktreeId, branch }) => [worktreeId, branch]),
			),
		};
		const live = new Set(agents.map((agent) => agent.agentKey));
		for (const key of ledgers.keys()) if (!live.has(key)) ledgers.delete(key);
	}

	function requestRefresh() {
		if (running) {
			requestedWhileRunning = true;
			return;
		}
		if (scheduled) return;
		scheduled = true;
		const timer = setTimeout(() => {
			scheduled = false;
			running = true;
			void refresh()
				.catch(() => undefined)
				.finally(() => {
					running = false;
					if (!requestedWhileRunning) return;
					requestedWhileRunning = false;
					requestRefresh();
				});
		}, refreshDelayMs);
		timer.unref?.();
	}

	function take(agent: LiveAgent, agents: LiveAgent[]) {
		const current = snapshot;
		if (!current || now() - current.computedAt > SNAPSHOT_MAX_AGE_MS)
			return undefined;
		const ledger = ledgers.get(agent.agentKey) ?? {
			delivered: new Map(),
			count: 0,
		};
		ledgers.set(agent.agentKey, ledger);
		const others = new Map(
			agents
				.filter((other) => other.worktreeId !== agent.worktreeId)
				.map((other) => [other.worktreeId, other]),
		);
		const fresh = current.overlaps
			.flatMap((overlap) => {
				const otherId = otherWorktree(overlap, agent.worktreeId);
				const other = otherId === undefined ? undefined : others.get(otherId);
				if (!other) return [];
				const key = `${other.worktreeId}\0${overlap.path}`;
				const previous = ledger.delivered.get(key);
				if (previous === "function" || previous === overlap.level) return [];
				return [{ key, overlap, other }];
			})
			.sort(
				(left, right) =>
					Number(right.overlap.level === "function") -
					Number(left.overlap.level === "function"),
			);
		const room = Math.min(
			MAX_NOTICES_PER_REPLY,
			MAX_NOTICES_PER_RUN - ledger.count,
		);
		if (fresh.length === 0 || room <= 0) return undefined;

		const shown = fresh.slice(0, room);
		for (const { key, overlap } of shown)
			ledger.delivered.set(key, overlap.level);
		ledger.count += shown.length;
		const notices = shown.map(
			({ overlap, other }): OverlapNotice => ({
				path: overlap.path,
				symbols: overlap.symbols,
				provider: other.harness,
				branch: current.branches.get(other.worktreeId),
			}),
		);
		const unlisted =
			ledger.count >= MAX_NOTICES_PER_RUN ? fresh.length - shown.length : 0;
		return { notices, unlisted };
	}

	return { refresh, requestRefresh, take };
}
