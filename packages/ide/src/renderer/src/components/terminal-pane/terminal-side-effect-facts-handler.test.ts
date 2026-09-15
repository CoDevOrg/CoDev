import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSideEffectBatch } from '../../../../shared/terminal-side-effect-facts'
import {
  _dispatchTerminalSideEffectBatchForTest,
  _resetTerminalSideEffectFactConsumersForTest,
  isMainTerminalSideEffectAuthorityForPty,
  registerTerminalSideEffectFactConsumer,
  type TerminalSideEffectFactConsumerCallbacks
} from './terminal-side-effect-facts-handler'

const PTY_ID = 'wt-1#1'

function createCallbackRecorder(): {
  callbacks: TerminalSideEffectFactConsumerCallbacks
  events: unknown[][]
} {
  const events: unknown[][] = []
  return {
    events,
    callbacks: {
      onTitleChange: (normalizedTitle, rawTitle) =>
        events.push(['title', normalizedTitle, rawTitle]),
      onBell: () => events.push(['bell']),
      onAgentBecameIdle: (title) => events.push(['idle', title]),
      onAgentBecameWorking: () => events.push(['working']),
      onAgentExited: () => events.push(['exited'])
    }
  }
}

function batch(
  facts: TerminalSideEffectBatch['facts'],
  options: Partial<TerminalSideEffectBatch> = {}
): TerminalSideEffectBatch {
  return { ptyId: PTY_ID, seq: 0, facts, ...options }
}

describe('isMainTerminalSideEffectAuthorityForPty', () => {
  const originalWindow = (globalThis as { window?: typeof window }).window

  beforeEach(() => {
    _resetTerminalSideEffectFactConsumersForTest()
    delete (globalThis as { window?: unknown }).window
  })

  afterEach(() => {
    _resetTerminalSideEffectFactConsumersForTest()
    if (originalWindow) {
      ;(globalThis as { window: typeof window }).window = originalWindow
    } else {
      delete (globalThis as { window?: typeof window }).window
    }
  })

  function setPersistedSettingsSync(settings: unknown): void {
    ;(globalThis as { window: unknown }).window = {
      api: { settings: { getSync: () => settings } }
    }
  }

  it('is on by default for PTYs whose bytes transit local main', () => {
    expect(
      isMainTerminalSideEffectAuthorityForPty({ settings: {}, runtimeEnvironmentId: null })
    ).toBe(true)
    // Why: settings hydrate asynchronously; the default-on switch must not
    // flip authority off during the null-settings startup window.
    expect(
      isMainTerminalSideEffectAuthorityForPty({ settings: null, runtimeEnvironmentId: null })
    ).toBe(true)
  })

  it('is off for remote-runtime PTYs regardless of the setting', () => {
    expect(
      isMainTerminalSideEffectAuthorityForPty({
        settings: { terminalMainSideEffectAuthority: true },
        runtimeEnvironmentId: 'env-1'
      })
    ).toBe(false)
  })

  it('is off when the kill switch is disabled', () => {
    expect(
      isMainTerminalSideEffectAuthorityForPty({
        settings: { terminalMainSideEffectAuthority: false },
        runtimeEnvironmentId: null
      })
    ).toBe(false)
  })

  it('honors the persisted kill switch before settings hydrate', () => {
    // Why: the authority decision is made once at transport creation; a pane
    // bound during startup must not pick main authority when the user
    // persisted the switch off.
    setPersistedSettingsSync({ terminalMainSideEffectAuthority: false })

    expect(
      isMainTerminalSideEffectAuthorityForPty({ settings: null, runtimeEnvironmentId: null })
    ).toBe(false)
  })

  it('stays on pre-hydration when the persisted switch is on or unset', () => {
    setPersistedSettingsSync({ terminalMainSideEffectAuthority: true })
    expect(
      isMainTerminalSideEffectAuthorityForPty({ settings: null, runtimeEnvironmentId: null })
    ).toBe(true)

    _resetTerminalSideEffectFactConsumersForTest()
    setPersistedSettingsSync({})
    expect(
      isMainTerminalSideEffectAuthorityForPty({ settings: null, runtimeEnvironmentId: null })
    ).toBe(true)
  })

  it('prefers hydrated settings over the persisted sync read', () => {
    setPersistedSettingsSync({ terminalMainSideEffectAuthority: false })

    expect(
      isMainTerminalSideEffectAuthorityForPty({
        settings: { terminalMainSideEffectAuthority: true },
        runtimeEnvironmentId: null
      })
    ).toBe(true)
  })

  it('caches the sync read so panes do not re-block per bind', () => {
    const getSync = vi.fn(() => ({ terminalMainSideEffectAuthority: false }))
    ;(globalThis as { window: unknown }).window = { api: { settings: { getSync } } }

    isMainTerminalSideEffectAuthorityForPty({ settings: null, runtimeEnvironmentId: null })
    isMainTerminalSideEffectAuthorityForPty({ settings: null, runtimeEnvironmentId: null })

    expect(getSync).toHaveBeenCalledTimes(1)
  })
})

describe('registerTerminalSideEffectFactConsumer', () => {
  const originalWindow = (globalThis as { window?: typeof window }).window

  beforeEach(() => {
    _resetTerminalSideEffectFactConsumersForTest()
    delete (globalThis as { window?: unknown }).window
  })

  afterEach(() => {
    _resetTerminalSideEffectFactConsumersForTest()
    if (originalWindow) {
      ;(globalThis as { window: typeof window }).window = originalWindow
    } else {
      delete (globalThis as { window?: typeof window }).window
    }
  })

  it('routes live facts to the registered consumer in batch order', () => {
    const { callbacks, events } = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {
        ...callbacks,
        onAgentStatus: (payload) => events.push(['status', payload.state, payload.agentType])
      }
    })

    _dispatchTerminalSideEffectBatchForTest(
      batch([
        {
          kind: 'agent-status',
          payload: { state: 'working', prompt: 'fix it', agentType: 'codex' }
        },
        { kind: 'title', normalizedTitle: '⠋ Claude', rawTitle: '⠋ Claude' },
        { kind: 'agent-working' },
        { kind: 'title', normalizedTitle: '✳ Claude', rawTitle: '✳ Claude' },
        { kind: 'agent-idle', title: '✳ Claude' },
        { kind: 'bell' }
      ])
    )

    expect(events).toEqual([
      ['status', 'working', 'codex'],
      ['title', '⠋ Claude', '⠋ Claude'],
      ['working'],
      ['title', '✳ Claude', '✳ Claude'],
      ['idle', '✳ Claude'],
      ['bell']
    ])
  })

  it('routes command-finished and pr-link facts to the registered consumer', () => {
    const events: unknown[][] = []
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {
        onCommandFinished: (exitCode) => events.push(['finished', exitCode]),
        onPrLink: (link) => events.push(['pr', link.url, link.number])
      }
    })

    _dispatchTerminalSideEffectBatchForTest(
      batch([
        { kind: 'command-finished', exitCode: 130 },
        {
          kind: 'pr-link',
          link: {
            url: 'https://github.com/acme/orca/pull/42',
            slug: { owner: 'acme', repo: 'orca' },
            number: 42
          }
        },
        { kind: 'command-finished', exitCode: null }
      ])
    )

    expect(events).toEqual([
      ['finished', 130],
      ['pr', 'https://github.com/acme/orca/pull/42', 42],
      ['finished', null]
    ])
  })

  it('stops routing after the consumer unregisters', () => {
    const { callbacks, events } = createCallbackRecorder()
    const dispose = registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks })

    dispose()
    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }]))

    expect(events).toEqual([])
  })

  it('hands off facts emitted between the parked watcher unregistering and the pane registering', () => {
    // Why: the reveal window — the watcher unregisters synchronously in the
    // effect flush, the pane registers only after its async reattach resolves,
    // and replay is title-only, so an unbuffered bell/command-code-done is lost.
    const watcher = createCallbackRecorder()
    const disposeWatcher = registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: watcher.callbacks
    })
    disposeWatcher()

    const events: unknown[][] = []
    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'bell' }, { kind: 'command-code-done', prompt: 'Fix the spinner' }], {
        seq: 7
      })
    )
    // A PTY that never had a consumer stays dropped — no buffer was opened.
    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }], { ptyId: 'never-consumed' }))

    expect(events).toEqual([])
    expect(watcher.events).toEqual([])

    const neverConsumed = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({
      ptyId: 'never-consumed',
      callbacks: neverConsumed.callbacks
    })
    expect(neverConsumed.events).toEqual([])

    const dispose = registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {
        onBell: () => events.push(['bell']),
}
    })

    expect(events).toEqual([['bell']])
    expect(watcher.events).toEqual([])

    // Drained exactly once: a later registration gets nothing.
    dispose()
    const later: unknown[][] = []
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {
        onBell: () => later.push(['bell']),
}
    })

    expect(later).toEqual([])
  })

  it('does not buffer replay batches across a handoff', () => {
    // Why: the next consumer requests its own snapshot; a held replay would
    // regress the title it just restored.
    const dispose = registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: createCallbackRecorder().callbacks
    })
    dispose()

    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'title', normalizedTitle: 'stale', rawTitle: 'stale' }], {
        replay: true,
        seq: 5
      })
    )

    const { callbacks, events } = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks })

    expect(events).toEqual([])
  })

  it('drains the handoff buffer before the register snapshot, so the replay is stale', async () => {
    // Why: the drained live title sets lastLiveTitleSeq, which is what makes
    // the async snapshot's older title lose to the fact the pane already got.
    const snapshot = batch([{ kind: 'title', normalizedTitle: 'snapshot', rawTitle: 'snapshot' }], {
      replay: true,
      seq: 20
    })
    ;(globalThis as { window: unknown }).window = {
      api: { pty: { getSideEffectSnapshot: vi.fn(async () => snapshot) } }
    }

    const dispose = registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: createCallbackRecorder().callbacks
    })
    dispose()
    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'title', normalizedTitle: 'live', rawTitle: 'live' }], { seq: 20 })
    )

    const { callbacks, events } = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks,
      restoreTitleOnRegister: true
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(events).toEqual([['title', 'live', 'live']])
  })

  it('drops a handoff-buffered batch once the buffer TTL expires', () => {
    vi.useFakeTimers()
    try {
      const dispose = registerTerminalSideEffectFactConsumer({
        ptyId: PTY_ID,
        callbacks: createCallbackRecorder().callbacks
      })
      dispose()
      _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }]))
      expect(vi.getTimerCount()).toBe(1)

      vi.advanceTimersByTime(15_001)
      expect(vi.getTimerCount()).toBe(0)

      const { callbacks, events } = createCallbackRecorder()
      registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks })

      expect(events).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('subscribes to the channel once and routes IPC batches', () => {
    let channelCallback: ((batch: TerminalSideEffectBatch) => void) | null = null
    const onSideEffect = vi.fn((callback: (batch: TerminalSideEffectBatch) => void) => {
      channelCallback = callback
      return () => {
        channelCallback = null
      }
    })
    ;(globalThis as { window: unknown }).window = {
      api: { pty: { onSideEffect } }
    }
    const first = createCallbackRecorder()
    const second = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks: first.callbacks })
    registerTerminalSideEffectFactConsumer({ ptyId: 'pty-2', callbacks: second.callbacks })

    expect(onSideEffect).toHaveBeenCalledTimes(1)
    channelCallback!(batch([{ kind: 'bell' }], { ptyId: 'pty-2' }))
    expect(second.events).toEqual([['bell']])
  })

  it('applies the title snapshot on register unless the registration was replaced', async () => {
    let resolveSnapshot: (value: TerminalSideEffectBatch | null) => void = () => {}
    const getSideEffectSnapshot = vi.fn(
      () =>
        new Promise<TerminalSideEffectBatch | null>((resolve) => {
          resolveSnapshot = resolve
        })
    )
    ;(globalThis as { window: unknown }).window = {
      api: { pty: { getSideEffectSnapshot } }
    }

    const first = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: first.callbacks,
      restoreTitleOnRegister: true
    })
    expect(getSideEffectSnapshot).toHaveBeenCalledWith(PTY_ID)

    // Replace before the snapshot resolves: the slow snapshot must not fire
    // into the superseded registration.
    const second = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks: second.callbacks })
    resolveSnapshot(
      batch([{ kind: 'title', normalizedTitle: 'restored', rawTitle: 'restored' }], {
        replay: true,
        seq: 5
      })
    )
    await Promise.resolve()

    expect(first.events).toEqual([])
    expect(second.events).toEqual([])
  })

  it('restores the snapshot title for a live registration', async () => {
    const snapshot = batch([{ kind: 'title', normalizedTitle: 'restored', rawTitle: 'restored' }], {
      replay: true,
      seq: 5
    })
    ;(globalThis as { window: unknown }).window = {
      api: { pty: { getSideEffectSnapshot: vi.fn(async () => snapshot) } }
    }
    const { callbacks, events } = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks,
      restoreTitleOnRegister: true
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(events).toEqual([['title', 'restored', 'restored']])
  })
})
