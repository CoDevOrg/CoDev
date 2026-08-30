import { describe, expect, it, vi } from 'vitest'
import {
  codevProposalComment,
  getCodevProposalWorktreeId,
  openCodevManagedProposalWorktree,
  requestCodevProposalCreate,
  requestCodevProposalDiscard
} from './codev-proposal-discard'

const worktreeId = 'c1f9fe13-6881-44a6-adbd-96bc5a946afa'

describe('getCodevProposalWorktreeId', () => {
  it('recognizes only CoDev agent worktree paths', () => {
    expect(
      getCodevProposalWorktreeId(
        `/srv/codev/workspaces/workspace/.git/codev-agent-worktrees/${worktreeId}`
      )
    ).toBe(worktreeId)
    expect(getCodevProposalWorktreeId(`/tmp/worktrees/${worktreeId}`)).toBeNull()
  })

  it('recognizes a native Orca worktree tagged with the CoDev proposal comment', () => {
    expect(getCodevProposalWorktreeId('/srv/codev/workspaces/workspace-agent', '')).toBeNull()
    expect(
      getCodevProposalWorktreeId(
        '/srv/codev/workspaces/workspace-agent',
        codevProposalComment(worktreeId)
      )
    ).toBe(worktreeId)
  })
})

describe('openCodevManagedProposalWorktree', () => {
  it('creates a native Orca worktree card tagged for audited discard', async () => {
    const createWorktree = vi.fn().mockResolvedValue({ worktree: { id: 'orca-wt-1' } })
    const updateComment = vi.fn().mockResolvedValue(undefined)

    await expect(
      openCodevManagedProposalWorktree(worktreeId, {
        repoId: 'repo-1',
        createWorktree,
        updateComment
      })
    ).resolves.toBe('orca-wt-1')
    expect(createWorktree).toHaveBeenCalledWith(
      'repo-1',
      'codev-c1f9fe13',
      undefined,
      'skip',
      undefined,
      undefined,
      'Managed proposal'
    )
    expect(updateComment).toHaveBeenCalledWith('orca-wt-1', codevProposalComment(worktreeId))
  })

  it('requires an open workspace project before creating the native card', async () => {
    await expect(
      openCodevManagedProposalWorktree(worktreeId, {
        repoId: null,
        createWorktree: vi.fn(),
        updateComment: vi.fn()
      })
    ).rejects.toThrow('Open the workspace project before preparing a managed proposal.')
  })
})

describe('requestCodevProposalDiscard', () => {
  it('asks the CoDev parent to run the audited discard lifecycle', async () => {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>()
    const parent = { postMessage: vi.fn() }
    const targetWindow = {
      __CODEV_EMBEDDED__: true,
      parent,
      location: { origin: 'https://codev.example' },
      addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
        listeners.delete(listener),
      setTimeout,
      clearTimeout
    } as unknown as Window

    const resultPromise = requestCodevProposalDiscard(
      `/srv/codev/workspaces/workspace/.git/codev-agent-worktrees/${worktreeId}`,
      { window: targetWindow, timeoutMs: 500 }
    )
    const request = parent.postMessage.mock.calls[0]?.[0]
    expect(request).toEqual({
      type: 'codev:discard-proposal',
      requestId: expect.any(String),
      worktreeId
    })
    for (const listener of listeners) {
      listener({
        origin: 'https://codev.example',
        source: parent,
        data: {
          type: 'codev:proposal-discard-result',
          requestId: request.requestId,
          managed: true,
          ok: true
        }
      } as unknown as MessageEvent<unknown>)
    }

    await expect(resultPromise).resolves.toEqual({
      type: 'codev:proposal-discard-result',
      requestId: request.requestId,
      managed: true,
      ok: true
    })
  })

  it('asks the CoDev parent using a tagged native worktree comment', async () => {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>()
    const parent = { postMessage: vi.fn() }
    const targetWindow = {
      __CODEV_EMBEDDED__: true,
      parent,
      location: { origin: 'https://codev.example' },
      addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
        listeners.delete(listener),
      setTimeout,
      clearTimeout
    } as unknown as Window

    const resultPromise = requestCodevProposalDiscard('/srv/codev/workspaces/workspace-agent', {
      window: targetWindow,
      timeoutMs: 500,
      comment: codevProposalComment(worktreeId)
    })
    const request = parent.postMessage.mock.calls[0]?.[0]
    expect(request).toEqual({
      type: 'codev:discard-proposal',
      requestId: expect.any(String),
      worktreeId
    })
    for (const listener of listeners) {
      listener({
        origin: 'https://codev.example',
        source: parent,
        data: {
          type: 'codev:proposal-discard-result',
          requestId: request.requestId,
          managed: true,
          ok: true
        }
      } as unknown as MessageEvent<unknown>)
    }

    await expect(resultPromise).resolves.toEqual({
      type: 'codev:proposal-discard-result',
      requestId: request.requestId,
      managed: true,
      ok: true
    })
  })
})

describe('requestCodevProposalCreate', () => {
  it('asks the CoDev parent to prepare a managed proposal', async () => {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>()
    const parent = { postMessage: vi.fn() }
    const targetWindow = {
      __CODEV_EMBEDDED__: true,
      parent,
      location: { origin: 'https://codev.example' },
      addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
        listeners.delete(listener),
      setTimeout,
      clearTimeout
    } as unknown as Window

    const resultPromise = requestCodevProposalCreate({ window: targetWindow, timeoutMs: 500 })
    const request = parent.postMessage.mock.calls[0]?.[0]
    expect(request).toEqual({ type: 'codev:create-proposal', requestId: expect.any(String) })
    for (const listener of listeners) {
      listener({
        origin: 'https://codev.example',
        source: parent,
        data: {
          type: 'codev:proposal-create-result',
          requestId: request.requestId,
          ok: true,
          worktreeId
        }
      } as unknown as MessageEvent<unknown>)
    }

    await expect(resultPromise).resolves.toEqual({
      type: 'codev:proposal-create-result',
      requestId: request.requestId,
      ok: true,
      worktreeId
    })
  })

  it('allows sandbox worktree provisioning to use the extended default timeout', async () => {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>()
    const parent = { postMessage: vi.fn() }
    let requestedTimeout: number | undefined
    const targetWindow = {
      __CODEV_EMBEDDED__: true,
      parent,
      location: { origin: 'https://codev.example' },
      addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
        listeners.delete(listener),
      setTimeout: vi.fn((_callback: TimerHandler, timeout?: number) => {
        requestedTimeout = timeout
        return 1
      }),
      clearTimeout: vi.fn()
    } as unknown as Window

    const resultPromise = requestCodevProposalCreate({ window: targetWindow })
    const request = parent.postMessage.mock.calls[0]?.[0]
    expect(requestedTimeout).toBe(60_000)
    for (const listener of listeners) {
      listener({
        origin: 'https://codev.example',
        source: parent,
        data: {
          type: 'codev:proposal-create-result',
          requestId: request.requestId,
          ok: true,
          worktreeId
        }
      } as unknown as MessageEvent<unknown>)
    }

    await expect(resultPromise).resolves.toEqual({
      type: 'codev:proposal-create-result',
      requestId: request.requestId,
      ok: true,
      worktreeId
    })
  })
})
