import { describe, expect, it } from 'vitest'
import { resolvePaneDisplayTitle, resolvePaneTitleDecision } from './terminal-title-evidence'

describe('resolvePaneDisplayTitle', () => {

  it('passes an unowned title through unchanged', () => {
    expect(resolvePaneDisplayTitle('bash', undefined)).toBe('bash')
  })
})

describe('resolvePaneTitleDecision', () => {

  it('DOM-gates a genuine Gemini pane while preserving its raw title', () => {
    const decision = resolvePaneTitleDecision({
      normalizedTitle: '✦ Gemini CLI',
      rawTitle: '✦ Gemini CLI',
      displayOwnerAgentType: 'gemini',
      rendererOwnerAgentType: 'gemini',
      userGpuMode: 'auto'
    })
    expect(decision.rawTitle).toBe('✦ Gemini CLI')
    expect(decision.rendererPolicy.gpuEnabled).toBe(false)
    expect(decision.rendererPolicy.reason).toBe('agent-compatibility')
  })
})
