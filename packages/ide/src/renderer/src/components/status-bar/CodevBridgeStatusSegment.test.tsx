import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevBridgeStatusView } from './CodevBridgeStatusSegment'

describe('CodevBridgeStatusView', () => {
  it('renders connected status for the workspace-bound CoDev bridge', () => {
    const html = renderToStaticMarkup(
      <CodevBridgeStatusView
        snapshot={{
          status: 'connected',
          label: 'CoDev · Connected',
          detail: 'Workspace-bound request bridge is connected.'
        }}
        compact={false}
        iconOnly={false}
        onInterrupt={() => undefined}
        onReconnect={() => undefined}
      />
    )
    expect(html).toContain('CoDev bridge connection status: Connected')
    expect(html).toContain('CoDev · Connected')
  })

  it('renders reconnect after an interrupted bridge', () => {
    const html = renderToStaticMarkup(
      <CodevBridgeStatusView
        snapshot={{
          status: 'disconnected',
          label: 'CoDev · Disconnected',
          detail: 'Workspace-bound request bridge is interrupted.'
        }}
        compact={false}
        iconOnly={false}
        onInterrupt={() => undefined}
        onReconnect={() => undefined}
      />
    )
    expect(html).toContain('CoDev bridge connection status: Disconnected')
    expect(html).toContain('CoDev · Disconnected')
  })
})
