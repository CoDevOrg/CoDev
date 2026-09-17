import type { JSX, ReactNode } from 'react'

/**
 * The workspace center — chat, terminal, pages — stays mounted as the primary
 * surface. Team channels are currently hidden from the embedded UI, so this
 * wrapper intentionally never covers or inerts the chat.
 */
export function CodevCenterUnderlay({
  className,
  children
}: {
  className: string
  children: ReactNode
}): JSX.Element {
  return <div className={className}>{children}</div>
}
