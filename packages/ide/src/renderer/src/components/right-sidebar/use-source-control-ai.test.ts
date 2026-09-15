import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { getSourceControlAiControllerDiscoveryHostKey } from './use-source-control-ai'

describe('getSourceControlAiControllerDiscoveryHostKey', () => {

  it('uses the active runtime environment before SSH connection scope', () => {
    const settings = {
      ...getDefaultSettings('/tmp'),
      activeRuntimeEnvironmentId: 'env-1'
    }

    expect(getSourceControlAiControllerDiscoveryHostKey(settings, 'ssh-1')).toBe('runtime:env-1')
  })
})
