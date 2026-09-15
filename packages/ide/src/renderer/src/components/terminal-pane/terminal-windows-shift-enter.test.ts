import { describe, expect, it } from 'vitest'
import {
  resolveWindowsShiftEnterEncodingForPane
} from './terminal-windows-shift-enter'

describe('resolveWindowsShiftEnterEncoding', () => {

  it('keeps trusted process and shell evidence authoritative over titles', () => {
    const state = {
      paneForegroundAgentByPaneKey: {
        'tab:pane': {
          agent: 'codex' as const,
          routingTrusted: true,
          shellForeground: false
        }
      },
      agentLaunchConfigByPaneKey: {}
    }

    expect(resolveWindowsShiftEnterEncodingForPane(state, 'tab:pane', 'Pi ready')).toBe('alt-enter')
    expect(
      resolveWindowsShiftEnterEncodingForPane(
        {
          paneForegroundAgentByPaneKey: {
            'tab:pane': { agent: null, shellForeground: true }
          },
          agentLaunchConfigByPaneKey: {}
        },
        'tab:pane',
        'Pi ready'
      )
    ).toBe('alt-enter')
  })

  it('keeps legacy bytes for plain shell and unsupported-agent titles', () => {
    const state = {
      paneForegroundAgentByPaneKey: {},
      agentLaunchConfigByPaneKey: {}
    }

    expect(resolveWindowsShiftEnterEncodingForPane(state, 'tab:pane', 'C:\\work\\pi-project')).toBe(
      'alt-enter'
    )
    expect(resolveWindowsShiftEnterEncodingForPane(state, 'tab:pane', 'Codex')).toBe('alt-enter')
  })

  it('does not let hook status route bytes without a pane title or process proof', () => {
    const state = {
      paneForegroundAgentByPaneKey: {},
      agentStatusByPaneKey: {
        'tab:pane': { agentType: 'droid' as const }
      },
      agentLaunchConfigByPaneKey: {}
    }

    expect(resolveWindowsShiftEnterEncodingForPane(state, 'tab:pane')).toBe('alt-enter')
  })

  it('keeps launch ownership on its original leaf after a split sibling survives', () => {
    const state = {
      paneForegroundAgentByPaneKey: {},
      agentLaunchConfigByPaneKey: {
        'tab:launched-droid': { identity: { agentType: 'droid' } }
      }
    }

    expect(resolveWindowsShiftEnterEncodingForPane(state, 'tab:launched-droid')).toBe('alt-enter')
    // Why: after split→close leaves only the sibling, pane count is no longer
    // ownership evidence; the surviving leaf must keep the legacy fallback.
    expect(resolveWindowsShiftEnterEncodingForPane(state, 'tab:surviving-sibling')).toBe(
      'alt-enter'
    )
  })

})
