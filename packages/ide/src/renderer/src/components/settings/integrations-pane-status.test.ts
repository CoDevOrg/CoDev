import { describe, expect, it } from 'vitest'
import type { } from '../../../../preload/api-types'
import {
  getPreflightIntegrationStatuses,
} from './integrations-pane-status'

describe('tokenApiStatusFromPreflight', () => {

})

describe('giteaStatusFromPreflight', () => {
})

describe('getPreflightIntegrationStatuses', () => {
  it('shows checking before preflight status arrives', () => {
    expect(getPreflightIntegrationStatuses(null, new Set()).ghStatus).toBe('checking')
  })

})
