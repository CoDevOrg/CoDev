import { describe, expect, it, vi } from 'vitest'
import type { PreloadApi } from '../../../preload/api-types'
import {
  createCodevWebApi,
  mergeCodevEducation,
  seedCodevWebPreferences
} from './codev-web-preferences'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    }
  }
}

describe('CoDev owned web preferences', () => {
  it('retains the existing first-open defaults without resetting later choices', () => {
    const store = storage()
    seedCodevWebPreferences(store)
    expect(JSON.parse(store.getItem('orca.web.settings.v1')!)).toEqual({
      showMobileButton: false,
      codevMobileDefaultApplied: true
    })
    expect(JSON.parse(store.getItem('orca.web.ui.v1')!)).toEqual({
      rightSidebarTab: 'codev-agents',
      rightSidebarOpen: true,
      codevLiveAgentsDefaultApplied: true
    })
    store.setItem(
      'orca.web.ui.v1',
      JSON.stringify({
        rightSidebarTab: 'codev-activity',
        rightSidebarOpen: false,
        codevLiveAgentsDefaultApplied: true
      })
    )
    store.setItem(
      'orca.web.settings.v1',
      JSON.stringify({ showMobileButton: true, codevMobileDefaultApplied: true })
    )
    seedCodevWebPreferences(store)
    expect(JSON.parse(store.getItem('orca.web.settings.v1')!).showMobileButton).toBe(true)
    expect(JSON.parse(store.getItem('orca.web.ui.v1')!).rightSidebarOpen).toBe(false)
  })

  it('preserves dismissed education across workspace hydration without mutating incoming state', () => {
    const store = storage()
    mergeCodevEducation(
      { featureTipsSeenIds: ['cmd-j-palette'], contextualToursSeenIds: ['browser'] },
      store
    )
    const incoming = { featureTipsSeenIds: [] }
    expect(mergeCodevEducation(incoming, store)).toEqual({
      featureTipsSeenIds: ['cmd-j-palette'],
      contextualToursSeenIds: ['browser']
    })
    expect(incoming.featureTipsSeenIds).toEqual([])
  })

  it('validates stored IDs and tolerates corrupted or unavailable browser storage', () => {
    const store = storage()
    store.setItem(
      'codev.featureEducationSeen.v1',
      JSON.stringify({
        featureTipsSeenIds: ['cmd-j-palette', 42, 'unknown'],
        contextualToursSeenIds: null
      })
    )
    expect(mergeCodevEducation({}, store).featureTipsSeenIds).toEqual(['cmd-j-palette'])
    store.setItem('orca.web.settings.v1', 'bad json')
    expect(() => seedCodevWebPreferences(store)).not.toThrow()
    const denied = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      }
    }
    expect(() => seedCodevWebPreferences(denied)).not.toThrow()
    expect(
      mergeCodevEducation({ featureTipsSeenIds: ['cmd-j-palette'] }, denied).featureTipsSeenIds
    ).toEqual(['cmd-j-palette'])
  })

  it('normalizes only hosted GitHub preflight and propagates runtime failures', async () => {
    const raw = {
      git: { installed: true },
      gh: { installed: false, authenticated: false },
      glab: { installed: false }
    }
    const check = vi.fn().mockResolvedValue(raw)
    const base = { preflight: { check } } as unknown as Partial<PreloadApi>
    const api = createCodevWebApi(base, storage())
    const result = await api.preflight!.check()
    expect(result.gh).toEqual({ installed: true, authenticated: true })
    expect(result.git).toEqual(raw.git)
    expect(result.glab).toEqual(raw.glab)
    expect(raw.gh.installed).toBe(false)
    check.mockRejectedValueOnce(new Error('offline'))
    await expect(api.preflight!.check()).rejects.toThrow('offline')
    expect(base.preflight!.check).toBe(check)
  })
})
