import { describe, expect, it } from 'vitest'
import {
  normalizeTaskProviderSettings,
  normalizeVisibleTaskProviders,
  resolveVisibleTaskProvider
} from './task-providers'

describe('task providers', () => {
  it('normalizes provider lists while dropping unsupported providers', () => {
    expect(normalizeVisibleTaskProviders(['github', 'unknown', 'github', 'gitlab'])).toEqual([
      'github'
    ])
  })

  it('falls back to all providers when none are visible', () => {
    expect(normalizeVisibleTaskProviders([])).toEqual(['github'])
  })

  it('normalizes invalid saved defaults to the first visible provider', () => {
    expect(
      normalizeTaskProviderSettings({
        visibleTaskProviders: ['github'],
        defaultTaskSource: 'bitbucket'
      })
    ).toEqual({
      defaultTaskSource: 'github',
      visibleTaskProviders: ['github']
    })
  })

  it('resolves unsupported preferred providers to the first visible provider', () => {
    expect(resolveVisibleTaskProvider('linear', ['github'])).toBe('github')
  })
})
