import "server-only";

import {
  BRIEF_FILES_MAX,
  recordBrainEntrySchema,
  updateAgentBriefSchema,
  type AgentBrief,
  type AgentBriefStatus,
  type BrainEntry,
  type BrainEntryKind,
  type BrainOverlap,
  type BrainOverlapKind,
} from "@codev/contracts";
import { schema } from "@codev/db";
import { and, desc, eq, gt, inArray } from "drizzle-orm";

import { appendWorkspaceEvent } from "./audit";
import { claimPatternsOverlap } from "./agent-coordination";
import { getDatabase } from "./database";
import { displayMemberName } from "./shared-session-view";

/**
 * The workspace brain. One shared, queryable picture of what every agent
 * session in a workspace is trying to do (`agent_briefs`), what has already
 * been tried (`brain_entries`), and where two sessions are about to collide
 * (`brain_overlaps`). Overlap detection is warn-only — it records and
 * surfaces a risk, it never blocks a write.
 */

// --------------------------------------------------------------------------
// Lexical helpers — pure, exported for tests. "Same problem, described
// differently" is caught by a cheap keyword prefilter here plus an optional
// LLM adjudication pass (see `detectWorkspaceOverlaps`).
// --------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "into",
  "onto",
  "your",
  "you",
  "our",
  "are",
  "was",
  "were",
  "will",
  "would",
  "should",
  "could",
  "can",
  "not",
  "but",
  "its",
  "it's",
  "has",
  "have",
  "had",
  "then",
  "than",
  "them",
  "they",
  "their",
  "there",
  "here",
  "when",
  "what",
  "which",
  "who",
  "whom",
  "how",
  "why",
  "add",
  "make",
  "use",
  "using",
  "get",
  "set",
  "new",
  "old",
  "fix",
  "update",
  "change",
  "so",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "is",
  "be",
  "as",
  "an",
  "or",
  "if",
  "we",
  "do",
  "does",
  "done",
]);

const BRIEF_KEYWORD_CAP = 40;
const ENTRY_KEYWORD_CAP = 30;

/** Lowercase word set with stopwords and very short tokens removed. */
export function tokenize(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const token = raw.trim();
    if (token.length < 3) continue;
    if (STOPWORDS.has(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

export function keywordsFromText(texts: string[], cap = BRIEF_KEYWORD_CAP) {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([token]) => token);
}

/** Jaccard similarity of two keyword sets — 0 when either is empty. */
export function keywordSimilarity(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Path patterns from two briefs that claim the same file or subtree. */
export function overlappingPaths(a: string[], b: string[]) {
  const shared: string[] = [];
  for (const left of a) {
    for (const right of b) {
      if (claimPatternsOverlap(left, right)) {
        shared.push(left === right ? left : `${left} ∩ ${right}`);
      }
    }
  }
  return [...new Set(shared)];
}

// Thresholds. The prefilter is deliberately loose so the LLM adjudicator
// sees every plausible pair; the lexical-only fallback is strict so a
// warning without a model behind it is still trustworthy.
export const DUPLICATE_PREFILTER = 0.18;
export const DUPLICATE_LEXICAL_ONLY = 0.5;
const FILE_OVERLAP_MIN = 1;

/**
 * Decide whether a lexically-similar pair of goals should be recorded as a
 * `duplicate_intent` overlap. With an adjudicator verdict we trust it; with
 * none we only warn when the keyword overlap is high on its own.
 */
export function resolveDuplicateIntent(
  lexicalScore: number,
  verdict:
    | { sameWork: boolean; confidence: number; rationale: string }
    | undefined,
): { record: boolean; score: number; rationale: string; adjudicated: boolean } {
  if (verdict) {
    if (!verdict.sameWork) {
      return { record: false, score: 0, rationale: "", adjudicated: true };
    }
    return {
      record: true,
      score: Number(Math.max(verdict.confidence, lexicalScore).toFixed(3)),
      rationale:
        verdict.rationale || "An agent judged these goals to be the same work.",
      adjudicated: true,
    };
  }
  if (lexicalScore >= DUPLICATE_LEXICAL_ONLY) {
    return {
      record: true,
      score: Number(lexicalScore.toFixed(3)),
      rationale:
        "High keyword overlap between the two goals (lexical match only).",
      adjudicated: false,
    };
  }
  return { record: false, score: 0, rationale: "", adjudicated: false };
}

// --------------------------------------------------------------------------
// Briefs
// --------------------------------------------------------------------------

type BriefRow = typeof schema.agentBriefs.$inferSelect;

function toAgentBrief(row: BriefRow): AgentBrief {
  return {
    sessionId: row.sessionId,
    workspaceId: row.workspaceId,
    goal: row.goal,
    approachSummary: row.approachSummary,
    planSteps: row.planSteps,
    currentStep: row.currentStep,
    filesLikelyToTouch: row.filesLikelyToTouch,
    keywords: row.keywords,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireSession(workspaceId: string, sessionId: string) {
  const [session] = await getDatabase()
    .select({
      id: schema.agentSessions.id,
      worktreeStatus: schema.worktrees.status,
    })
    .from(schema.agentSessions)
    .innerJoin(
      schema.worktrees,
      eq(schema.agentSessions.worktreeId, schema.worktrees.id),
    )
    .where(
      and(
        eq(schema.agentSessions.id, sessionId),
        eq(schema.agentSessions.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!session) throw new Error("Agent session not found.");
  return session;
}

function briefKeywords(row: {
  goal: string;
  approachSummary: string;
  currentStep: string;
  planSteps: { label: string }[];
  filesLikelyToTouch: string[];
}) {
  return keywordsFromText([
    row.goal,
    row.approachSummary,
    row.currentStep,
    ...row.planSteps.map((step) => step.label),
    ...row.filesLikelyToTouch.map((path) => path.replace(/[^a-z0-9]+/gi, " ")),
  ]);
}

/**
 * Create or patch a session's brief. Any subset of fields may be supplied;
 * the rest keep their stored value. Keywords are always recomputed so the
 * overlap prefilter never runs on a stale set.
 */
export async function updateAgentBrief(
  workspaceId: string,
  sessionId: string,
  rawInput: unknown,
): Promise<AgentBrief> {
  const input = updateAgentBriefSchema.parse(rawInput);
  await requireSession(workspaceId, sessionId);

  const brief = await getDatabase().transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(schema.agentBriefs)
      .where(eq(schema.agentBriefs.sessionId, sessionId))
      .limit(1);

    const merged = {
      goal: input.goal ?? existing?.goal ?? "",
      approachSummary: input.approachSummary ?? existing?.approachSummary ?? "",
      planSteps: input.planSteps ?? existing?.planSteps ?? [],
      currentStep: input.currentStep ?? existing?.currentStep ?? "",
      filesLikelyToTouch: (
        input.filesLikelyToTouch ??
        existing?.filesLikelyToTouch ??
        []
      ).slice(0, BRIEF_FILES_MAX),
      status:
        input.status ?? existing?.status ?? ("planning" as AgentBriefStatus),
    };
    const keywords = briefKeywords(merged);

    const [row] = await transaction
      .insert(schema.agentBriefs)
      .values({ workspaceId, sessionId, ...merged, keywords })
      .onConflictDoUpdate({
        target: schema.agentBriefs.sessionId,
        set: { ...merged, keywords, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("Could not save the agent brief.");
    return row;
  });

  await appendWorkspaceEvent({
    workspaceId,
    type: "brain.brief_updated",
    payload: {
      sessionId,
      status: brief.status,
      goal: brief.goal.slice(0, 200),
    },
  });
  await safeDetectOverlaps(workspaceId);

  return toAgentBrief(brief);
}

export async function getAgentBrief(
  workspaceId: string,
  sessionId: string,
): Promise<AgentBrief | null> {
  await requireSession(workspaceId, sessionId);
  const [row] = await getDatabase()
    .select()
    .from(schema.agentBriefs)
    .where(eq(schema.agentBriefs.sessionId, sessionId))
    .limit(1);
  return row ? toAgentBrief(row) : null;
}

export type WorkspaceBriefEntry = AgentBrief & {
  sessionName: string;
  ownerName: string;
  worktreeName: string;
};

/** Every brief whose session still has a live (active or frozen) worktree. */
export async function listWorkspaceBriefs(
  workspaceId: string,
): Promise<WorkspaceBriefEntry[]> {
  const rows = await getDatabase()
    .select({
      brief: schema.agentBriefs,
      sessionName: schema.agentSessions.name,
      worktreeName: schema.worktrees.name,
      ownerName: schema.users.name,
      ownerLogin: schema.users.login,
    })
    .from(schema.agentBriefs)
    .innerJoin(
      schema.agentSessions,
      eq(schema.agentBriefs.sessionId, schema.agentSessions.id),
    )
    .innerJoin(
      schema.worktrees,
      eq(schema.agentSessions.worktreeId, schema.worktrees.id),
    )
    .leftJoin(schema.users, eq(schema.agentSessions.createdBy, schema.users.id))
    .where(
      and(
        eq(schema.agentBriefs.workspaceId, workspaceId),
        inArray(schema.worktrees.status, ["active", "frozen"]),
      ),
    )
    .orderBy(desc(schema.agentBriefs.updatedAt));

  return rows.map((row) => ({
    ...toAgentBrief(row.brief),
    sessionName: row.sessionName,
    worktreeName: row.worktreeName,
    ownerName: displayMemberName(row.ownerName, row.ownerLogin ?? undefined),
  }));
}

// --------------------------------------------------------------------------
// Entries — the durable history
// --------------------------------------------------------------------------

type EntryRow = typeof schema.brainEntries.$inferSelect;

function toBrainEntry(row: EntryRow, authorName: string | null): BrainEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sessionId: row.sessionId,
    authorId: row.authorId,
    authorName,
    kind: row.kind,
    title: row.title,
    body: row.body,
    paths: row.paths,
    keywords: row.keywords,
    supersedesId: row.supersedesId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function recordBrainEntry(
  workspaceId: string,
  sessionId: string | null,
  authorId: string | null,
  rawInput: unknown,
): Promise<BrainEntry> {
  const input = recordBrainEntrySchema.parse(rawInput);
  if (sessionId) await requireSession(workspaceId, sessionId);

  const keywords = keywordsFromText(
    [
      input.title,
      input.body,
      ...input.paths.map((p) => p.replace(/[^a-z0-9]+/gi, " ")),
    ],
    ENTRY_KEYWORD_CAP,
  );

  const [row] = await getDatabase()
    .insert(schema.brainEntries)
    .values({
      workspaceId,
      sessionId,
      authorId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      paths: input.paths,
      keywords,
      supersedesId: input.supersedesId ?? null,
    })
    .returning();
  if (!row) throw new Error("Could not record the brain entry.");

  await appendWorkspaceEvent({
    workspaceId,
    actorId: authorId,
    type: "brain.entry_recorded",
    payload: { entryId: row.id, kind: row.kind, title: row.title },
  });

  return toBrainEntry(row, null);
}

async function loadEntries(
  workspaceId: string,
  options: { limit?: number; kinds?: BrainEntryKind[] } = {},
): Promise<BrainEntry[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = await getDatabase()
    .select({
      entry: schema.brainEntries,
      authorName: schema.users.name,
      authorLogin: schema.users.login,
    })
    .from(schema.brainEntries)
    .leftJoin(schema.users, eq(schema.brainEntries.authorId, schema.users.id))
    .where(
      options.kinds?.length
        ? and(
            eq(schema.brainEntries.workspaceId, workspaceId),
            inArray(schema.brainEntries.kind, options.kinds),
          )
        : eq(schema.brainEntries.workspaceId, workspaceId),
    )
    .orderBy(desc(schema.brainEntries.createdAt))
    .limit(limit);
  return rows.map((row) =>
    toBrainEntry(
      row.entry,
      row.authorName
        ? displayMemberName(row.authorName, row.authorLogin ?? undefined)
        : null,
    ),
  );
}

export async function listBrainEntries(
  workspaceId: string,
  options: { limit?: number; kinds?: BrainEntryKind[]; query?: string } = {},
): Promise<BrainEntry[]> {
  const entries = await loadEntries(workspaceId, {
    limit: options.query ? 200 : (options.limit ?? 50),
    ...(options.kinds?.length ? { kinds: options.kinds } : {}),
  });
  if (!options.query?.trim()) return entries;
  const needle = tokenize(options.query);
  const ranked = entries
    .map((entry) => ({
      entry,
      score: keywordSimilarity(needle, entry.keywords),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 20);
  return ranked.map((row) => row.entry);
}

/**
 * The agent-facing lookup: given a free-text intent, return the past entries
 * and the other live briefs that most resemble it.
 */
export async function searchBrain(
  workspaceId: string,
  sessionId: string,
  options: { query: string; limit?: number },
) {
  const limit = options.limit ?? 8;
  const needle = tokenize(options.query);
  const [entries, briefs] = await Promise.all([
    loadEntries(workspaceId, { limit: 200 }),
    listWorkspaceBriefs(workspaceId),
  ]);

  const rankedEntries = entries
    .map((entry) => ({
      entry,
      score: keywordSimilarity(needle, entry.keywords),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => ({ ...row.entry, score: Number(row.score.toFixed(3)) }));

  const rankedBriefs = briefs
    .filter((brief) => brief.sessionId !== sessionId)
    .map((brief) => ({
      brief,
      score: keywordSimilarity(needle, brief.keywords),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => ({ ...row.brief, score: Number(row.score.toFixed(3)) }));

  return { entries: rankedEntries, briefs: rankedBriefs };
}

// --------------------------------------------------------------------------
// Overlap detection
// --------------------------------------------------------------------------

export type OverlapAdjudication = {
  leftSessionId: string;
  rightSessionId: string;
  sameWork: boolean;
  confidence: number;
  rationale: string;
};

export type OverlapAdjudicator = (
  pairs: Array<{
    leftSessionId: string;
    rightSessionId: string;
    left: { goal: string; approachSummary: string };
    right: { goal: string; approachSummary: string };
  }>,
) => Promise<OverlapAdjudication[]>;

type OverlapCandidate = {
  leftSessionId: string;
  rightSessionId: string;
  kind: BrainOverlapKind;
  score: number;
  evidence: Record<string, unknown>;
  rationale: string;
};

function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Recompute the workspace's overlap set from current briefs and live path
 * claims. `file_overlap` and `claim_contest` are purely mechanical.
 * `duplicate_intent` uses a lexical prefilter, then — when an adjudicator is
 * supplied — one LLM call to decide whether the pair is really the same
 * work; without one it falls back to a strict lexical threshold.
 */
export async function detectWorkspaceOverlaps(
  workspaceId: string,
  options: { adjudicator?: OverlapAdjudicator } = {},
): Promise<BrainOverlap[]> {
  const database = getDatabase();
  const briefs = await listWorkspaceBriefs(workspaceId);
  const bySession = new Map(briefs.map((brief) => [brief.sessionId, brief]));

  const claimRows = briefs.length
    ? await database
        .select({
          sessionId: schema.pathClaims.sessionId,
          pathGlob: schema.pathClaims.pathGlob,
        })
        .from(schema.pathClaims)
        .where(
          and(
            inArray(
              schema.pathClaims.sessionId,
              briefs.map((brief) => brief.sessionId),
            ),
            inArray(schema.pathClaims.status, ["active", "contested"]),
            gt(schema.pathClaims.expiresAt, new Date()),
          ),
        )
    : [];
  const claimsBySession = new Map<string, string[]>();
  for (const claim of claimRows) {
    const list = claimsBySession.get(claim.sessionId) ?? [];
    list.push(claim.pathGlob);
    claimsBySession.set(claim.sessionId, list);
  }

  const candidates: OverlapCandidate[] = [];
  const duplicatePrefiltered: Array<{
    leftSessionId: string;
    rightSessionId: string;
    left: { goal: string; approachSummary: string };
    right: { goal: string; approachSummary: string };
    lexicalScore: number;
  }> = [];

  for (let i = 0; i < briefs.length; i += 1) {
    for (let j = i + 1; j < briefs.length; j += 1) {
      const a = briefs[i]!;
      const b = briefs[j]!;
      const [leftSessionId, rightSessionId] = orderPair(
        a.sessionId,
        b.sessionId,
      );

      const claimClash = overlappingPaths(
        claimsBySession.get(a.sessionId) ?? [],
        claimsBySession.get(b.sessionId) ?? [],
      );
      if (claimClash.length) {
        candidates.push({
          leftSessionId,
          rightSessionId,
          kind: "claim_contest",
          score: 1,
          evidence: { paths: claimClash },
          rationale: `Both sessions hold path claims on ${claimClash.join(", ")}.`,
        });
      }

      const fileClash = overlappingPaths(
        a.filesLikelyToTouch,
        b.filesLikelyToTouch,
      );
      if (fileClash.length >= FILE_OVERLAP_MIN) {
        candidates.push({
          leftSessionId,
          rightSessionId,
          kind: "file_overlap",
          score: Number(
            (
              fileClash.length /
              Math.max(
                a.filesLikelyToTouch.length +
                  b.filesLikelyToTouch.length -
                  fileClash.length,
                1,
              )
            ).toFixed(3),
          ),
          evidence: { paths: fileClash },
          rationale: `Both plan to edit ${fileClash.join(", ")}.`,
        });
      }

      const lexicalScore = keywordSimilarity(a.keywords, b.keywords);
      if (lexicalScore >= DUPLICATE_PREFILTER) {
        duplicatePrefiltered.push({
          leftSessionId,
          rightSessionId,
          left:
            leftSessionId === a.sessionId
              ? { goal: a.goal, approachSummary: a.approachSummary }
              : { goal: b.goal, approachSummary: b.approachSummary },
          right:
            rightSessionId === b.sessionId
              ? { goal: b.goal, approachSummary: b.approachSummary }
              : { goal: a.goal, approachSummary: a.approachSummary },
          lexicalScore,
        });
      }
    }
  }

  if (duplicatePrefiltered.length) {
    let adjudications: OverlapAdjudication[] = [];
    if (options.adjudicator) {
      try {
        adjudications = await options.adjudicator(
          duplicatePrefiltered.map((pair) => ({
            leftSessionId: pair.leftSessionId,
            rightSessionId: pair.rightSessionId,
            left: pair.left,
            right: pair.right,
          })),
        );
      } catch {
        adjudications = [];
      }
    }
    const verdictByPair = new Map(
      adjudications.map((verdict) => [
        `${verdict.leftSessionId}:${verdict.rightSessionId}`,
        verdict,
      ]),
    );
    for (const pair of duplicatePrefiltered) {
      const decision = resolveDuplicateIntent(
        pair.lexicalScore,
        verdictByPair.get(`${pair.leftSessionId}:${pair.rightSessionId}`),
      );
      if (!decision.record) continue;
      candidates.push({
        leftSessionId: pair.leftSessionId,
        rightSessionId: pair.rightSessionId,
        kind: "duplicate_intent",
        score: decision.score,
        evidence: {
          lexicalScore: Number(pair.lexicalScore.toFixed(3)),
          adjudicated: decision.adjudicated,
        },
        rationale: decision.rationale,
      });
    }
  }

  return persistOverlaps(workspaceId, candidates, bySession);
}

async function persistOverlaps(
  workspaceId: string,
  candidates: OverlapCandidate[],
  liveSessions: Map<string, unknown>,
): Promise<BrainOverlap[]> {
  const database = getDatabase();
  const existing = await database
    .select()
    .from(schema.brainOverlaps)
    .where(eq(schema.brainOverlaps.workspaceId, workspaceId));

  const candidateKey = (c: {
    leftSessionId: string;
    rightSessionId: string;
    kind: string;
  }) => `${c.leftSessionId}:${c.rightSessionId}:${c.kind}`;
  const liveKeys = new Set(candidates.map(candidateKey));
  let changed = false;

  for (const candidate of candidates) {
    const [row] = await database
      .insert(schema.brainOverlaps)
      .values({
        workspaceId,
        leftSessionId: candidate.leftSessionId,
        rightSessionId: candidate.rightSessionId,
        kind: candidate.kind,
        score: candidate.score,
        evidence: candidate.evidence,
        rationale: candidate.rationale,
      })
      .onConflictDoUpdate({
        target: [
          schema.brainOverlaps.workspaceId,
          schema.brainOverlaps.leftSessionId,
          schema.brainOverlaps.rightSessionId,
          schema.brainOverlaps.kind,
        ],
        // Refresh the evidence but never silently reopen a risk a human
        // already acknowledged or resolved.
        set: {
          score: candidate.score,
          evidence: candidate.evidence,
          rationale: candidate.rationale,
          detectedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    if (row && row.status === "open") changed = true;
  }

  // A risk that no longer holds — the plans diverged, a claim was released,
  // or a session ended — is auto-resolved. Acknowledged rows stay put.
  const stale = existing.filter(
    (row) =>
      row.status === "open" &&
      (!liveKeys.has(candidateKey(row)) ||
        !liveSessions.has(row.leftSessionId) ||
        !liveSessions.has(row.rightSessionId)),
  );
  if (stale.length) {
    await database
      .update(schema.brainOverlaps)
      .set({ status: "resolved", updatedAt: new Date() })
      .where(
        inArray(
          schema.brainOverlaps.id,
          stale.map((row) => row.id),
        ),
      );
    changed = true;
  }

  const open = await database
    .select()
    .from(schema.brainOverlaps)
    .where(
      and(
        eq(schema.brainOverlaps.workspaceId, workspaceId),
        inArray(schema.brainOverlaps.status, ["open", "acknowledged"]),
      ),
    )
    .orderBy(desc(schema.brainOverlaps.score));

  if (changed) {
    await appendWorkspaceEvent({
      workspaceId,
      type: "brain.overlaps_updated",
      payload: {
        open: open.filter((row) => row.status === "open").length,
        kinds: [...new Set(open.map((row) => row.kind))],
      },
    });
  }

  return open.map(toBrainOverlap);
}

type OverlapRow = typeof schema.brainOverlaps.$inferSelect;

function toBrainOverlap(row: OverlapRow): BrainOverlap {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    leftSessionId: row.leftSessionId,
    rightSessionId: row.rightSessionId,
    kind: row.kind,
    score: row.score,
    evidence: row.evidence,
    rationale: row.rationale,
    status: row.status,
    detectedAt: row.detectedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listWorkspaceOverlaps(
  workspaceId: string,
): Promise<BrainOverlap[]> {
  const rows = await getDatabase()
    .select()
    .from(schema.brainOverlaps)
    .where(
      and(
        eq(schema.brainOverlaps.workspaceId, workspaceId),
        inArray(schema.brainOverlaps.status, ["open", "acknowledged"]),
      ),
    )
    .orderBy(desc(schema.brainOverlaps.score));
  return rows.map(toBrainOverlap);
}

export async function updateOverlapStatus(
  workspaceId: string,
  overlapId: string,
  status: "open" | "acknowledged" | "resolved",
): Promise<BrainOverlap> {
  const [row] = await getDatabase()
    .update(schema.brainOverlaps)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(schema.brainOverlaps.id, overlapId),
        eq(schema.brainOverlaps.workspaceId, workspaceId),
      ),
    )
    .returning();
  if (!row) throw new Error("Overlap not found.");
  return toBrainOverlap(row);
}

/** Fire-and-forget detection that never surfaces its own failure. */
export async function safeDetectOverlaps(
  workspaceId: string,
  options: { adjudicator?: OverlapAdjudicator } = {},
) {
  try {
    await detectWorkspaceOverlaps(workspaceId, options);
  } catch {
    // Detection is advisory; a failure must not break the caller's turn.
  }
}

// --------------------------------------------------------------------------
// Briefing — the always-on context an agent turn starts with
// --------------------------------------------------------------------------

export type WorkspaceBrainBriefing = {
  text: string;
  otherAgents: number;
  overlaps: number;
  priorAttempts: number;
};

/**
 * Assemble the "what else is going on" block injected at the top of every
 * agent turn. Returns null when the brain has nothing relevant to say.
 */
export async function buildAgentBriefing(
  workspaceId: string,
  sessionId: string,
  intent: string,
): Promise<WorkspaceBrainBriefing | null> {
  const [briefs, overlaps, search] = await Promise.all([
    listWorkspaceBriefs(workspaceId),
    listWorkspaceOverlaps(workspaceId),
    searchBrain(workspaceId, sessionId, { query: intent, limit: 5 }),
  ]);

  const others = briefs.filter((brief) => brief.sessionId !== sessionId);
  const mine = new Set([sessionId]);
  const relevantOverlaps = overlaps.filter(
    (overlap) =>
      mine.has(overlap.leftSessionId) || mine.has(overlap.rightSessionId),
  );

  if (!others.length && !relevantOverlaps.length && !search.entries.length) {
    return null;
  }

  const lines: string[] = ["## Workspace Brain briefing"];

  if (others.length) {
    lines.push("", "Other agents active in this workspace right now:");
    for (const brief of others) {
      const goal = brief.goal.trim() || "(no goal posted yet)";
      const step = brief.currentStep.trim();
      lines.push(
        `- ${brief.ownerName}'s agent on \`${brief.worktreeName}\` [${brief.status}] (session ${brief.sessionId}) — ${goal}${
          step ? ` · currently: ${step}` : ""
        }${
          brief.filesLikelyToTouch.length
            ? ` · files: ${brief.filesLikelyToTouch.slice(0, 8).join(", ")}`
            : ""
        }`,
      );
    }
  }

  if (relevantOverlaps.length) {
    lines.push("", "⚠️ Overlap the brain has flagged for your session:");
    const nameBySession = new Map(
      briefs.map((brief) => [brief.sessionId, `${brief.ownerName}'s agent`]),
    );
    for (const overlap of relevantOverlaps) {
      const otherId =
        overlap.leftSessionId === sessionId
          ? overlap.rightSessionId
          : overlap.leftSessionId;
      lines.push(
        `- vs ${nameBySession.get(otherId) ?? "another agent"} (session ${otherId}) (${overlap.kind.replace(/_/g, " ")}, score ${overlap.score}): ${overlap.rationale}`,
      );
    }
    // The session ids above are what makes this instruction followable:
    // `request_claim_coordination` has to be addressed to one, and an agent
    // reading only this briefing has no other way to learn it.
    lines.push(
      "Coordinate before you proceed: request_claim_coordination addressed to the session id above, post_team_chat, or narrow your scope. This is a warning, not a block.",
    );
  }

  if (search.entries.length) {
    lines.push("", "Relevant history from earlier work here:");
    for (const entry of search.entries) {
      lines.push(
        `- [${entry.kind}] ${entry.title}${entry.body ? ` — ${entry.body.slice(0, 240)}` : ""}`,
      );
    }
  }

  return {
    text: lines.join("\n"),
    otherAgents: others.length,
    overlaps: relevantOverlaps.length,
    priorAttempts: search.entries.filter(
      (entry) => entry.kind === "attempt" || entry.kind === "dead_end",
    ).length,
  };
}
