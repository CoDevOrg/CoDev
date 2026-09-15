import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FIELD_SOURCE = readFileSync(join(__dirname, 'SmartWorkspaceNameField.tsx'), 'utf8').replace(
  /\r\n?/g,
  '\n'
)

describe('SmartWorkspaceNameField repo-backed source boundaries', () => {
  it('can hide the global add-project cross-repo action for subordinate task sources', () => {
    expect(FIELD_SOURCE).toContain('allowCrossRepoProjectAdd?: boolean')
    expect(FIELD_SOURCE).toContain('allowCrossRepoProjectAdd = true')
    expect(FIELD_SOURCE).toContain('!crossRepoPrompt || !allowCrossRepoProjectAdd')
    expect(FIELD_SOURCE).toContain(') : allowCrossRepoProjectAdd ? (')
  })

  it('reports the active source mode without lifting source search state', () => {
    expect(FIELD_SOURCE).toContain('onActiveSourceModeChange?: (mode: SmartNameMode) => void')
    expect(FIELD_SOURCE).toContain('onActiveSourceModeChange')
    expect(FIELD_SOURCE).toContain('onActiveSourceModeChange?.(mode)')
    expect(FIELD_SOURCE).toContain('[mode, onActiveSourceModeChange]')
  })

  it('defers the source popover until composer interaction', () => {
    expect(FIELD_SOURCE).toContain('deferSourcePopoverUntilInteractionRef')
    expect(FIELD_SOURCE).toContain('handleSourcePopoverOpenChange')
    expect(FIELD_SOURCE).toContain('isComposerFieldToFieldFocus')
    expect(FIELD_SOURCE).toContain('onPointerDown={() => {')
    expect(FIELD_SOURCE).toContain('markSourcePopoverUserEngaged()')
  })

  it('confines source-mode overflow to the source strip', () => {
    expect(FIELD_SOURCE).toContain('overflow-x-auto overflow-y-hidden px-0 scrollbar-sleek')
  })
})
