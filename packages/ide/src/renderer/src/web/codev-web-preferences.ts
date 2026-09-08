import type { PreloadApi } from '../../../preload/api-types'
import type { PersistedUIState } from '../../../shared/types'
import { normalizeFeatureTipIds } from '../../../shared/feature-tips'
import { normalizeContextualTourIds } from '../../../shared/contextual-tours'

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>
const SEEN_KEY = 'codev.featureEducationSeen.v1'

function read(storage: PreferenceStorage, key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '{}')
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function write(storage: PreferenceStorage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    /* Preferences remain usable when storage is unavailable. */
  }
}

export function seedCodevWebPreferences(storage: PreferenceStorage): void {
  const settings = read(storage, 'orca.web.settings.v1')
  if (!settings.codevMobileDefaultApplied) {
    write(storage, 'orca.web.settings.v1', {
      ...settings,
      showMobileButton: false,
      codevMobileDefaultApplied: true
    })
  }
  const ui = read(storage, 'orca.web.ui.v1')
  if (!ui.codevLiveAgentsDefaultApplied) {
    write(storage, 'orca.web.ui.v1', {
      ...ui,
      rightSidebarTab: ui.rightSidebarTab ?? 'codev-agents',
      rightSidebarOpen: ui.rightSidebarOpen ?? true,
      codevLiveAgentsDefaultApplied: true
    })
  }
}

export function mergeCodevEducation<T extends Partial<PersistedUIState>>(
  state: T,
  storage: PreferenceStorage
): T & Pick<PersistedUIState, 'featureTipsSeenIds' | 'contextualToursSeenIds'> {
  const seen = read(storage, SEEN_KEY)
  const featureTipsSeenIds = normalizeFeatureTipIds([
    ...normalizeFeatureTipIds(seen.featureTipsSeenIds),
    ...normalizeFeatureTipIds(state.featureTipsSeenIds)
  ])
  const contextualToursSeenIds = normalizeContextualTourIds([
    ...normalizeContextualTourIds(seen.contextualToursSeenIds),
    ...normalizeContextualTourIds(state.contextualToursSeenIds)
  ])
  write(storage, SEEN_KEY, { featureTipsSeenIds, contextualToursSeenIds })
  return { ...state, featureTipsSeenIds, contextualToursSeenIds }
}

export function createCodevWebApi(
  api: Partial<PreloadApi>,
  storage: PreferenceStorage
): Partial<PreloadApi> {
  const ui = api.ui
  const preflight = api.preflight
  return {
    ...api,
    ...(ui
      ? {
          ui: {
            ...ui,
            get: async () => mergeCodevEducation(await ui.get(), storage),
            set: (patch) => {
              mergeCodevEducation(patch, storage)
              return ui.set(patch)
            },
            onStateChanged: (listener) =>
              ui.onStateChanged((state) => listener(mergeCodevEducation(state, storage)))
          }
        }
      : {}),
    ...(preflight
      ? {
          preflight: {
            ...preflight,
            check: async (args) => {
              const status = await preflight.check(args)
              // CoDev performs GitHub operations through its authenticated control plane.
              return { ...status, gh: { ...status.gh, installed: true, authenticated: true } }
            }
          }
        }
      : {})
  }
}
