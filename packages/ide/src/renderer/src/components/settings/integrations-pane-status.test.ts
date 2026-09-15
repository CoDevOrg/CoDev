import { describe, expect, it } from 'vitest'
import type { PreflightStatus } from '../../../../preload/api-types'
import {
  getPreflightIntegrationStatuses,
} from './integrations-pane-status'

const connectedPreflight: PreflightStatus = {
  git: { installed: true },
  gh: { installed: true, authenticated: true },
}

describe('tokenApiStatusFromPreflight', () => {

})

describe('giteaStatusFromPreflight', () => {
})

describe('getPreflightIntegrationStatuses', () => {
  it('shows checking before preflight status arrives', () => {
    expect(getPreflightIntegrationStatuses(null, new Set()).ghStatus).toBe('checking')
  })

  it('derives connected status labels and account details from preflight state', () => {
    expect(getPreflightIntegrationStatuses(connectedPreflight, new Set())).toMatchObject({
      ghStatus: 'connected',
      glabStatus: 'connected',
      bitbucketStatus: 'connected',
      bitbucketAccount: 'bb-user',
      azureDevOpsStatus: 'configured',
      azureDevOpsAccount: 'ado-user',
      giteaStatus: 'configured',
      giteaAccount: 'gitea-user'
    })
  })

})
