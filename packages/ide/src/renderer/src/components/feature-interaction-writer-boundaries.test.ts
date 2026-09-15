import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname

function componentSource(relativePath: string): string {
  return readFileSync(join(COMPONENT_ROOT, relativePath), 'utf8')
}

function sourceBetween(source: string, startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endPattern, start + startPattern.length)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('feature interaction writer boundaries', () => {
  it('keeps Cmd+J feature writers in open/selection handlers, not query or navigation rendering', () => {
    const source = componentSource('WorktreeJumpPalette.tsx')
    const renderStart = source.lastIndexOf('  return (')
    expect(renderStart).toBeGreaterThan(0)

    const handlerSection = source.slice(0, renderStart)
    const renderSection = source.slice(renderStart)

    const cmdJWriterPattern = /recordFeatureInteraction\('cmd-j/g
    const allCmdJWriterCount = source.match(cmdJWriterPattern)?.length ?? 0
    expect(allCmdJWriterCount).toBeGreaterThanOrEqual(6)
    expect(handlerSection.match(cmdJWriterPattern)?.length ?? 0).toBe(allCmdJWriterCount)
    expect(renderSection).not.toContain("recordFeatureInteraction('cmd-j")
    expect(
      sourceBetween(source, 'const handleQueryChange', 'const cancelFallbackFocusFrames')
    ).not.toContain("recordFeatureInteraction('cmd-j")
  })

  it('records Cmd+J create-workspace as its own destination, not a generic quick action', () => {
    const source = componentSource('WorktreeJumpPalette.tsx')
    const section = sourceBetween(source, 'const handleSelectQuickAction', 'const handleSelectItem')

    expect(section).toContain("recordFeatureInteraction('cmd-j-create-workspace')")
    expect(section).toContain("recordFeatureInteraction('cmd-j-quick-action')")
    expect(section.indexOf("recordFeatureInteraction('cmd-j-create-workspace')")).toBeLessThan(
      section.indexOf("recordFeatureInteraction('cmd-j-quick-action')")
    )
    expect(
      sourceBetween(
        section,
        "if (action.id === 'create-workspace')",
        "recordFeatureInteraction('cmd-j-quick-action')"
      )
    ).toContain('return')
  })

  it('records browser annotation agent handoff only from the prompt-delivered callback', () => {
    const source = componentSource('browser-pane/BrowserPane.tsx')
    expect(
      source.match(/recordFeatureInteraction\('browser-annotations-sent-to-agent'\)/g)
    ).toHaveLength(1)
    expect(
      sourceBetween(
        source,
        'const handleBrowserAnnotationsSentToAgent',
        'const handleClearBrowserAnnotations'
      )
    ).toContain("recordFeatureInteraction('browser-annotations-sent-to-agent')")
    expect(
      sourceBetween(
        source,
        'const handleCopyBrowserAnnotations',
        'const handleBrowserAnnotationsSentToAgent'
      )
    ).not.toContain("recordFeatureInteraction('browser-annotations-sent-to-agent')")
    expect(
      sourceBetween(
        source,
        'const handleClearBrowserAnnotations',
        'const handleDeleteBrowserAnnotation'
      )
    ).not.toContain("recordFeatureInteraction('browser-annotations-sent-to-agent')")
  })

  it('records floating workspace hide only from explicit disable or hide actions', () => {
    const allowedSources = [
      componentSource('settings/FloatingWorkspacePane.tsx'),
      componentSource('floating-terminal/FloatingTerminalIconContextMenu.tsx')
    ].join('\n')
    const passiveSources = [
      componentSource('../App.tsx'),
      componentSource('floating-terminal/FloatingTerminalPanel.tsx')
    ].join('\n')

    expect(
      allowedSources.match(/recordFeatureInteraction\('floating-workspace-hidden'\)/g) ?? []
    ).toHaveLength(2)
    expect(passiveSources).not.toContain("recordFeatureInteraction('floating-workspace-hidden')")
  })
})
