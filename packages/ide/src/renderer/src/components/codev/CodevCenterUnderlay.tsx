import type { JSX, ReactNode } from 'react'
import { useCodevChannelId } from '@/web/codev-channel-view'

/**
 * The workspace center — chat, terminal, pages — as the layer a team channel
 * sits over.
 *
 * The channel is an absolutely positioned layer and the chat stays mounted
 * beneath it so a running agent is never disturbed. Visually that is right;
 * for the keyboard it meant Tab walked straight from the channel's composer
 * into the hidden agent composer, and a screen reader still saw both. While a
 * channel is open the underlay is `inert`: out of the tab order, out of the
 * accessibility tree, still rendering and still running.
 */
export function CodevCenterUnderlay({
  className,
  children
}: {
  className: string
  children: ReactNode
}): JSX.Element {
  const covered = useCodevChannelId() !== null
  return (
    <div className={className} inert={covered || undefined}>
      {children}
    </div>
  )
}
