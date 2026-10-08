import { eq, isNull } from "drizzle-orm";
import type { HostDb } from "../db";
import { codevAgentRuns, terminalSessions } from "../db/schema";
import type { LiveAgent } from "./coordination-notices";

/** codev-guestd's native turn timeout is 15 minutes; a missed release expires soon after. */
const NATIVE_AGENT_TTL_MS = 20 * 60_000;
const MAX_NATIVE_AGENTS = 32;

export type CoordinatedAgent = LiveAgent & {
	hookId: string;
	hookTokenHash: string;
};

export function listSupersetAgents(db: HostDb): CoordinatedAgent[] {
	return db
		.select({
			codevRunId: codevAgentRuns.codevRunId,
			terminalId: codevAgentRuns.terminalId,
			worktreeId: codevAgentRuns.worktreeId,
			provider: codevAgentRuns.provider,
			hookTokenHash: codevAgentRuns.hookTokenHash,
		})
		.from(codevAgentRuns)
		.innerJoin(
			terminalSessions,
			eq(codevAgentRuns.terminalId, terminalSessions.id),
		)
		.where(isNull(terminalSessions.endedAt))
		.all()
		.map((run) => ({
			agentKey: run.codevRunId,
			hookId: run.terminalId,
			worktreeId: run.worktreeId,
			harness: run.provider === "openai" ? "codex" : "claude",
			hookTokenHash: run.hookTokenHash,
		}));
}

/**
 * Native guest-exec turns (every Cursor turn, and Codex or Claude when
 * Superset sessions are off) are not host terminals. codev-guestd registers
 * each one with a hash of its private hook token and releases it on exit.
 */
export function createNativeAgentRegistry(now: () => number = Date.now) {
	const agents = new Map<string, CoordinatedAgent & { expiresAt: number }>();

	function list(): CoordinatedAgent[] {
		const current = now();
		for (const [id, agent] of agents) {
			if (agent.expiresAt <= current) agents.delete(id);
		}
		return [...agents.values()].map(({ expiresAt: _, ...agent }) => agent);
	}

	function register(agent: Omit<CoordinatedAgent, "agentKey">) {
		const existing = agents.get(agent.hookId);
		if (existing && existing.hookTokenHash !== agent.hookTokenHash)
			return false;
		if (!existing && list().length >= MAX_NATIVE_AGENTS) return false;
		agents.set(agent.hookId, {
			...agent,
			agentKey: agent.hookId,
			expiresAt: now() + NATIVE_AGENT_TTL_MS,
		});
		return true;
	}

	function release(hookId: string) {
		agents.delete(hookId);
	}

	return { list, register, release };
}
