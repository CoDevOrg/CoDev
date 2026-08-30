import { describe, expect, it } from 'vitest'
import { isCodevEmbedded } from './codev-embedded'

describe('isCodevEmbedded', () => {
  it('is true when the runtime flag is set', () => {
    expect(isCodevEmbedded({ __CODEV_EMBEDDED__: true })).toBe(true)
  })

  it('is true from the codev=1 fragment before the flag is assigned', () => {
    expect(
      isCodevEmbedded({
        location: {
          hash: '#pairing=secret&codev=1&codevProject=%2Fsrv%2Fcodev%2Fworkspaces%2Fw&codevProjectKind=git'
        }
      })
    ).toBe(true)
  })

  it('is false for a stock Orca web client (no flag, no fragment)', () => {
    expect(isCodevEmbedded({ location: { hash: '#pairing=secret' } })).toBe(false)
    expect(isCodevEmbedded({})).toBe(false)
  })

  it('requires codev to equal exactly 1', () => {
    expect(isCodevEmbedded({ location: { hash: '#note=mentions-codev&codev=0' } })).toBe(false)
  })
})
