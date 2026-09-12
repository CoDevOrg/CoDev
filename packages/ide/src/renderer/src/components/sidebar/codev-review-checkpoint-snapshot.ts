/** The `review.list` payload the CoDev bridge returns, as the panel reads it. */
export type CodevReviewDiffPath = {
  path: string
  kind: 'added' | 'deleted' | 'modified' | 'binary'
  detail: string
}

export type CodevReviewCheckpoint = {
  sessionId: string
  slot: 1 | 2 | 3 | null
  assignment: string
  worktreeId: string
  worktree: string
  worktreeStatus: string
  prepared: boolean
  stale?: boolean
  baseRevision: string | null
  headRevision: string | null
  diffDigest: string | null
  summary: string | null
  additions: number
  deletions: number
  paths: CodevReviewDiffPath[]
}

export type CodevReviewSlot = {
  slot: 1 | 2 | 3
  occupied: boolean
  sessionId: string | null
  worktreeId: string | null
  assignment: string
}

export type CodevReviewApproval = {
  state: 'current' | 'stale' | 'integrated'
  blocked: boolean
  mergeStarted: boolean
}

export type CodevReviewIntegration = {
  actor: string
  role: string
  event: 'agent.review_merged'
  baseRevision: string
  headRevision: string
  mergedHeadSha: string
}

export type CodevReviewSnapshot = {
  viewer?: {
    id: string
    name: string
    role?: string
    canReview: boolean
    canMerge?: boolean
  }
  slots?: CodevReviewSlot[]
  checkpoints?: CodevReviewCheckpoint[]
  integrationHeadRevision?: string | null
  approval?: CodevReviewApproval
  integration?: CodevReviewIntegration | null
}
