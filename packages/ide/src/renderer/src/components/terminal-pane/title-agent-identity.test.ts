import { describe, expect, it } from 'vitest'
import { titleHasExplicitAgentIdentity } from './title-agent-identity'

describe('titleHasExplicitAgentIdentity', () => {

  it('rejects Devin path and compound fragments', () => {
    expect(titleHasExplicitAgentIdentity('C:\\work\\devin.exe\\ready')).toBe(false)
    expect(titleHasExplicitAgentIdentity('devin-fixtures ready')).toBe(false)
  })
})
