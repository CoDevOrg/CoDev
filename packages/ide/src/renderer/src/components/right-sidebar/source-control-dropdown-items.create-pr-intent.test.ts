import { describe, expect, it } from 'vitest'
import {
  resolveDropdownItems,
  type DropdownActionInputs,
  type } from './source-control-dropdown-items'

// Why: a shared defaults object keeps each case row terse while making the
// "this is the one knob that differs from the baseline" intent obvious.
function inputs(overrides: Partial<DropdownActionInputs> = {}): DropdownActionInputs {
  return {
    stagedCount: 0,
    hasUnstagedChanges: false,
    hasStageableChanges: false,
    hasPartiallyStagedChanges: false,
    hasMessage: false,
    hasUnresolvedConflicts: false,
    isCommitting: false,
    isRemoteOperationActive: false,
    upstreamStatus: undefined,
    ...overrides
  }
}

describe('resolveDropdownItems Create PR intent', () => {
  it('enables the push-before-PR recovery action when review creation is only blocked by unpushed commits', () => {
    const items = resolveDropdownItems(
      inputs({
        upstreamStatus: { hasUpstream: true, ahead: 2, behind: 0 },
        hostedReviewCreation: {
          provider: 'github',
          review: null,
          canCreate: false,
          blockedReason: 'needs_push',
          nextAction: 'push',
          reviewLookupOutcome: 'not_found'
        }
      })
    )
    const byKind = Object.fromEntries(
      items.filter((e) => e.kind !== 'separator').map((e) => [e.kind, e])
    )
    expect(byKind.create_pr.disabled).toBe(false)
    expect(byKind.create_pr.hint).toBe('Push first')
    expect(byKind.push_create_pr.label).toBe('Push before PR')
    expect(byKind.push_create_pr.disabled).toBe(false)
  })

})
