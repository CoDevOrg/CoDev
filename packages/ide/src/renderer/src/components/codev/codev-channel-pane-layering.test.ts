import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The channel pane and the chat share one stacking context: the chat renders
 * inside a `z-10` layer under `.pane`, which is `position: relative` with
 * `z-index: auto` and therefore creates no context of its own. A channel pane
 * below 10 shipped once and left only its header on screen over a live chat,
 * which reads as the channel failing to open.
 */
describe('codev channel pane layering', () => {
  const paneSource = readFileSync(
    join(process.cwd(), 'src/renderer/src/components/codev/CodevChannelPane.tsx'),
    'utf8'
  )
  const appSource = readFileSync(join(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')

  function tailwindZIndexes(source: string, marker: string): number[] {
    const values = source
      .split('\n')
      .filter((line) => line.includes(marker))
      .map((line) => /\bz-(?:\[)?(\d+)\]?/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]))
    expect(values.length, `no z-index found on any line containing ${marker}`).toBeGreaterThan(0)
    return values
  }

  const paneZ = tailwindZIndexes(paneSource, 'absolute inset-0')[0] as number
  // Every top-right overlay in the same container: the right-sidebar toggle and
  // the workspace profile switcher.
  const overlayZ = tailwindZIndexes(appSource, 'absolute top-0 z-')

  it('covers the chat layer it is meant to replace', () => {
    expect(paneZ).toBeGreaterThan(10)
  })

  it('leaves the top-right overlay chrome clickable above it', () => {
    expect(overlayZ).toHaveLength(2)
    for (const z of overlayZ) {
      expect(z).toBeGreaterThan(paneZ)
    }
  })
})
