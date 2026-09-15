import type { JSX } from 'react'

import { CodevProviderAccountCard } from './CodevProviderAccountCard'
import { ClaudeMark, CursorMark, OpenAIMark } from './CodevProviderLogos'
import type {
  CodevProviderConnectionSnapshot,
  CodevProviderSurface
} from './codev-provider-connection-types'
import { codevProviderSurfaceCapability } from './codev-provider-surface-capability'

const CARDS = [
  {
    label: 'Claude',
    logo: <ClaudeMark className="size-5" />,
    subscription: 'claude',
    connection: 'anthropic'
  },
  {
    label: 'Codex',
    logo: <OpenAIMark className="size-5" />,
    subscription: 'codex',
    connection: 'openai'
  },
  {
    label: 'Cursor',
    logo: <CursorMark className="size-5" />,
    subscription: 'cursor',
    connection: 'cursor'
  }
] as const

export function CodevProviderSurfaceCards({
  snapshot,
  surface,
  onSnapshot
}: {
  snapshot: CodevProviderConnectionSnapshot
  surface: CodevProviderSurface
  onSnapshot: (snapshot: CodevProviderConnectionSnapshot | null) => void
}): JSX.Element {
  return (
    <>
      {CARDS.map((card) => {
        if (surface === 'workspace' && card.connection === 'cursor') {
          return null
        }
        const subscription = snapshot.cliSubscriptions.find(
          (row) => row.provider === card.subscription
        )
        const connection = snapshot.connections.find((row) => row.provider === card.connection)
        if (!subscription || !connection) {
          return null
        }
        return (
          <CodevProviderAccountCard
            capability={codevProviderSurfaceCapability(snapshot, card.connection)}
            claudeCliToken={snapshot.claudeCliToken}
            connection={connection}
            hostedClaudeConnect={snapshot.hostedClaudeConnect && card.connection === 'anthropic'}
            hostedOpenAIConnect={
              Boolean(snapshot.hostedOpenAIConnect) && card.connection === 'openai'
            }
            key={`${surface}-${card.label}`}
            label={card.label}
            logo={card.logo}
            onSnapshot={onSnapshot}
            subscription={subscription}
            surface={surface}
          />
        )
      })}
    </>
  )
}
