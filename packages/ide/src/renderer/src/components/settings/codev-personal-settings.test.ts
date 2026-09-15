import { describe, expect, it } from 'vitest'
import {
  filterCodevEmbeddedSettingsSections,
  filterPersonalSettingsSections,
  isCodevEmbedded,
  isCodevEmbeddedHiddenSettingsSection,
  isCodevSettingsOnly,
  isPersonalSettingsSection
} from './codev-personal-settings'

describe('codev personal settings', () => {
  it('keeps personal sections and drops workspace-scoped ones', () => {
    const sections = [
      { id: 'agents' },
      { id: 'accounts' },
      { id: 'git' },
      { id: 'tasks' },
      { id: 'repo-abc' },
      { id: 'appearance' }
    ]

    expect(filterPersonalSettingsSections(sections, true).map((s) => s.id)).toEqual([
      'agents',
      'accounts',
      'appearance'
    ])
  })

  it('prepends CoDev-only personal sections that have no upstream nav entry', () => {
    const sections = [{ id: 'agents' }, { id: 'git' }]
    const extra = [{ id: 'codev-profile' }]

    expect(filterPersonalSettingsSections(sections, true, extra).map((s) => s.id)).toEqual([
      'codev-profile',
      'agents'
    ])
    // Only relevant in the personal surface — a real workspace has its own
    // page for this, so the extra section must not leak in there too.
    expect(filterPersonalSettingsSections(sections, false, extra).map((s) => s.id)).toEqual([
      'agents',
      'git'
    ])
  })

  it('leaves every section in place inside a workspace', () => {
    const sections = [{ id: 'agents' }, { id: 'git' }, { id: 'repo-abc' }]
    expect(filterPersonalSettingsSections(sections, false).map((s) => s.id)).toEqual([
      'agents',
      'git',
      'repo-abc'
    ])
  })

  it('treats per-repo panes as workspace-scoped', () => {
    expect(isPersonalSettingsSection('repo-abc')).toBe(false)
    expect(isPersonalSettingsSection('agents')).toBe(true)
  })

  it('reads the settings-only flag from the host window', () => {
    expect(isCodevSettingsOnly({ __CODEV_SETTINGS_ONLY__: true } as Window)).toBe(true)
    expect(isCodevSettingsOnly({} as Window)).toBe(false)
  })

  it('reads the embedded flag from the host window', () => {
    expect(isCodevEmbedded({ __CODEV_EMBEDDED__: true } as Window)).toBe(true)
    expect(isCodevEmbedded({} as Window)).toBe(false)
  })

  it('hides CLI app-connection panes that cannot run in a CoDev workspace', () => {
    expect(isCodevEmbeddedHiddenSettingsSection('integrations')).toBe(true)
    expect(isCodevEmbeddedHiddenSettingsSection('linear')).toBe(true)
    expect(isCodevEmbeddedHiddenSettingsSection('tasks')).toBe(true)
    expect(isCodevEmbeddedHiddenSettingsSection('accounts')).toBe(false)

    const sections = [
      { id: 'accounts' },
      { id: 'integrations' },
      { id: 'linear' },
      { id: 'tasks' },
      { id: 'git' }
    ]
    expect(filterCodevEmbeddedSettingsSections(sections, false).map((s) => s.id)).toEqual([
      'accounts',
      'integrations',
      'linear',
      'tasks',
      'git'
    ])
    expect(filterCodevEmbeddedSettingsSections(sections, true).map((s) => s.id)).toEqual([
      'accounts',
      'git'
    ])
  })
})
