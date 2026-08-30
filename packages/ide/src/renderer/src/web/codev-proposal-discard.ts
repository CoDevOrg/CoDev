export type CodevProposalDiscardResponse =
  | { type: 'codev:proposal-discard-result'; requestId: string; managed: false }
  | {
      type: 'codev:proposal-discard-result'
      requestId: string
      managed: true
      ok: true
    }
  | {
      type: 'codev:proposal-discard-result'
      requestId: string
      managed: true
      ok: false
      error: string
    }

export type CodevProposalCreateResponse =
  | { type: 'codev:proposal-create-result'; requestId: string; ok: true; worktreeId: string }
  | { type: 'codev:proposal-create-result'; requestId: string; ok: false; error: string }

const CODEV_AGENT_WORKTREE_PATH =
  /\/\.git\/codev-agent-worktrees\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i
const CODEV_PROPOSAL_COMMENT =
  /^codev-proposal:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const CODEV_WORKTREE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
let nextRequestId = 0

export function codevProposalComment(worktreeId: string): string {
  return `codev-proposal:${worktreeId}`
}

export function getCodevProposalWorktreeId(path: string, comment = ''): string | null {
  return CODEV_AGENT_WORKTREE_PATH.exec(path)?.[1] ?? CODEV_PROPOSAL_COMMENT.exec(comment)?.[1] ?? null
}

export async function openCodevManagedProposalWorktree(
  worktreeId: string,
  options: {
    repoId: string | null | undefined
    createWorktree: (
      repoId: string,
      name: string,
      baseBranch?: string,
      setupDecision?: 'inherit' | 'run' | 'skip',
      sparseCheckout?: undefined,
      telemetrySource?: undefined,
      displayName?: string
    ) => Promise<{ worktree: { id: string } }>
    updateComment: (orcaWorktreeId: string, comment: string) => Promise<void>
  }
): Promise<string> {
  if (!options.repoId) {
    throw new Error('Open the workspace project before preparing a managed proposal.')
  }
  if (!CODEV_WORKTREE_ID.test(worktreeId)) {
    throw new Error('CoDev did not return a managed proposal worktree.')
  }
  const created = await options.createWorktree(
    options.repoId,
    `codev-${worktreeId.slice(0, 8)}`,
    undefined,
    'skip',
    undefined,
    undefined,
    'Managed proposal'
  )
  await options.updateComment(created.worktree.id, codevProposalComment(worktreeId))
  return created.worktree.id
}

export async function requestCodevProposalDiscard(
  path: string,
  options: {
    window?: Window
    timeoutMs?: number
    comment?: string
  } = {}
): Promise<CodevProposalDiscardResponse | null> {
  const targetWindow = options.window ?? window
  const worktreeId = getCodevProposalWorktreeId(path, options.comment ?? '')
  if (!targetWindow.__CODEV_EMBEDDED__ || !worktreeId || targetWindow.parent === targetWindow) {
    return null
  }

  const requestId = `codev-proposal-discard-${++nextRequestId}`
  const timeoutMs = options.timeoutMs ?? 15_000

  return await new Promise((resolve, reject) => {
    const timeout = targetWindow.setTimeout(() => {
      targetWindow.removeEventListener('message', receiveResult)
      reject(new Error('CoDev did not confirm the proposal discard. Try again.'))
    }, timeoutMs)
    function receiveResult(event: MessageEvent<unknown>): void {
      if (
        event.origin !== targetWindow.location.origin ||
        event.source !== targetWindow.parent ||
        !event.data ||
        typeof event.data !== 'object' ||
        !('type' in event.data) ||
        event.data.type !== 'codev:proposal-discard-result' ||
        !('requestId' in event.data) ||
        event.data.requestId !== requestId
      ) {
        return
      }
      targetWindow.clearTimeout(timeout)
      targetWindow.removeEventListener('message', receiveResult)
      resolve(event.data as CodevProposalDiscardResponse)
    }
    targetWindow.addEventListener('message', receiveResult)
    targetWindow.parent.postMessage(
      { type: 'codev:discard-proposal', requestId, worktreeId },
      targetWindow.location.origin
    )
  })
}

export async function requestCodevProposalCreate(
  options: {
    window?: Window
    timeoutMs?: number
  } = {}
): Promise<CodevProposalCreateResponse | null> {
  const targetWindow = options.window ?? window
  if (!targetWindow.__CODEV_EMBEDDED__ || targetWindow.parent === targetWindow) {
    return null
  }

  const requestId = `codev-proposal-create-${++nextRequestId}`
  // A managed proposal reserves a worktree and waits for its sandbox path to
  // be provisioned. That can outlast the short interaction timeout used for
  // lightweight parent-window messages.
  const timeoutMs = options.timeoutMs ?? 60_000

  return await new Promise((resolve, reject) => {
    const timeout = targetWindow.setTimeout(() => {
      targetWindow.removeEventListener('message', receiveResult)
      reject(new Error('CoDev did not confirm the proposal creation. Try again.'))
    }, timeoutMs)
    function receiveResult(event: MessageEvent<unknown>): void {
      if (
        event.origin !== targetWindow.location.origin ||
        event.source !== targetWindow.parent ||
        !event.data ||
        typeof event.data !== 'object' ||
        !('type' in event.data) ||
        event.data.type !== 'codev:proposal-create-result' ||
        !('requestId' in event.data) ||
        event.data.requestId !== requestId
      ) {
        return
      }
      targetWindow.clearTimeout(timeout)
      targetWindow.removeEventListener('message', receiveResult)
      resolve(event.data as CodevProposalCreateResponse)
    }
    targetWindow.addEventListener('message', receiveResult)
    targetWindow.parent.postMessage(
      { type: 'codev:create-proposal', requestId },
      targetWindow.location.origin
    )
  })
}
