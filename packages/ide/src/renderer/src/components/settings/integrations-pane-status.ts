import type { PreflightStatus } from '../../../../preload/api-types'

export type GhStatus = 'checking' | 'connected' | 'not-installed' | 'not-authenticated'
export type PreflightRefreshProvider = 'gh'

export type PreflightIntegrationStatuses = {
  ghStatus: GhStatus
}

function ghStatusFromPreflight(status: PreflightStatus['gh']): GhStatus {
  if (!status.installed) {
    return 'not-installed'
  }
  return status.authenticated ? 'connected' : 'not-authenticated'
}

function maybeChecking<T extends string>(
  provider: PreflightRefreshProvider,
  refreshingProviders: ReadonlySet<PreflightRefreshProvider>,
  status: T
): T | 'checking' {
  return refreshingProviders.has(provider) ? 'checking' : status
}

export function getPreflightIntegrationStatuses(
  preflightStatus: PreflightStatus | null,
  refreshingProviders: ReadonlySet<PreflightRefreshProvider>
): PreflightIntegrationStatuses {
  if (!preflightStatus) {
    return { ghStatus: 'checking' }
  }
  return {
    ghStatus: maybeChecking('gh', refreshingProviders, ghStatusFromPreflight(preflightStatus.gh))
  }
}
