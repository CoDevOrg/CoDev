import type { ExecutionHostId, LOCAL_EXECUTION_HOST_ID } from './execution-host'
import type { Repo } from './types'

export type ListReposForExecutionHostArgs = { executionHostId: typeof LOCAL_EXECUTION_HOST_ID }

export type HostRepoCatalogSnapshot =
  | {
      authoritative: true
      authority: { kind: 'local'; executionHostId: typeof LOCAL_EXECUTION_HOST_ID }
      repos: readonly Repo[]
    }
  | {
      authoritative: false
      executionHostId: ExecutionHostId
      reason: 'authority-unknown' | 'stale' | 'unavailable' | 'rejected'
    }
