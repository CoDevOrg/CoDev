// @vitest-environment happy-dom

import { act, } from 'react'
import {  type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { } from '../../../shared/stable-pane-id'
import type { } from '@/store/slices/pane-foreground-agent'
import type {  } from '../../../shared/types'
import {
  resolveLaunchedAgentExitEvidence,
  resolveTabAgentFromSignals,
} from './use-tab-agent'

const initialAppState = useAppStore.getInitialState()
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const hookRoots: Root[] = []

describe('resolveTabAgentFromSignals process identity', () => {

  it('suppresses launch identity on shell-foreground evidence despite a stale agent title', () => {
    // Why: OSC 133;D is process-grade exit proof — a TUI that died without
    // restoring its title must not keep painting the tab.
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: '✳ Claude Code',
        hookAgent: null,
        processAgent: null,
        processShellForeground: true,
        launchAgent: 'claude'
      })
    ).toBeNull()
  })

  it('suppresses stuck-title identity once shell foreground is proven on a manual pane', () => {
    // Why: pre-probe-removal, the foreground read cleared icons for TUIs that
    // died with a stuck title; shell-foreground evidence restores that.
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: '✳ Claude Code',
        hookAgent: null,
        processAgent: null,
        processShellForeground: true,
        launchAgent: undefined
      })
    ).toBeNull()
  })

  it('keeps remote title identity even when a shell-foreground flag is passed', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: true,
        title: '✳ Claude Code',
        hookAgent: null,
        processAgent: null,
        processShellForeground: true,
        launchAgent: undefined
      })
    ).toBe('claude')
  })

  it('keeps launch identity while the recognized process is still in the foreground', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: 'zsh',
        hookAgent: null,
        processAgent: 'codex',
        launchAgent: 'codex'
      })
    ).toBe('codex')
  })
})

describe('resolveLaunchedAgentExitEvidence shell-foreground gate', () => {
  const baseArgs = {
    title: '✳ Claude Code',
    hasObservedAgentSignal: true,
    hookAgent: null,
    hasCompletedHook: false,
    processShellForeground: true
  }

  it('counts shell-foreground proof as local launched-agent exit evidence', () => {
    expect(resolveLaunchedAgentExitEvidence({ ...baseArgs, isRemote: false })).toBe(true)
  })

  it('never counts a shell-foreground flag as remote launched-agent exit evidence', () => {
    expect(resolveLaunchedAgentExitEvidence({ ...baseArgs, isRemote: true })).toBe(false)
  })
})

describe('useTabAgent process signals', () => {
  const clearTabLaunchAgent = vi.fn()

  beforeEach(() => {
    clearTabLaunchAgent.mockReset()
    useAppStore.setState(initialAppState, true)
    useAppStore.setState({
      ptyIdsByTabId: { 'tab-1': ['pty-1'] },
      terminalLayoutsByTabId: {
        'tab-1': {
          root: { type: 'leaf', leafId: LEAF_ID },
          activeLeafId: LEAF_ID,
          expandedLeafId: null,
          ptyIdsByLeafId: { [LEAF_ID]: 'pty-1' }
        }
      },
      agentStatusByPaneKey: {},
      clearTabLaunchAgent
    })
  })

  afterEach(() => {
    hookRoots.splice(0).forEach((root) => {
      act(() => root.unmount())
    })
    document.body.replaceChildren()
    useAppStore.setState(initialAppState, true)
  })

})
