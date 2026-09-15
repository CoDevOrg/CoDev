// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import {
  resolveLaunchedAgentExitEvidence,
  resolveTabAgentFromSignals
} from './use-tab-agent'

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

