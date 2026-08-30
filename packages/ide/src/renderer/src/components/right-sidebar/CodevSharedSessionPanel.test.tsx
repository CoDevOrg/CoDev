import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodevSharedSessionViewPanel, type CodevSharedSessionView } from './CodevSharedSessionPanel'

const view: CodevSharedSessionView = {
  session: {
    sessionId: 'f3100000-0000-4000-8000-000000000001',
    ownerId: 'b0200000-0000-4000-8000-000000000011',
    worktreeId: 'f3100000-0000-4000-8000-000000000002',
    provider: 'openai',
    model: 'gpt-5',
    state: 'interrupted',
    activeTurnId: null,
    streamCursor: 3,
    queue: [
      {
        id: 'f3100000-0000-4000-8000-000000000004',
        authorId: 'b0200000-0000-4000-8000-000000000012',
        prompt: 'Summarize the collaboration plan.',
        queuePosition: 1
      }
    ]
  },
  name: 'Shared',
  ownerName: 'Alex Morgan',
  worktreeName: 'agent-alex',
  model: 'gpt-5',
  attributedQueue: [
    {
      id: 'f3100000-0000-4000-8000-000000000004',
      authorId: 'b0200000-0000-4000-8000-000000000012',
      authorName: 'Jordan Lee',
      prompt: 'Summarize the collaboration plan.',
      queuePosition: 1
    }
  ],
  transcript: [
    {
      position: 1,
      turnId: 'f3100000-0000-4000-8000-000000000003',
      authorId: 'b0200000-0000-4000-8000-000000000011',
      authorName: 'Alex Morgan',
      prompt: 'Inspect the repository layout.',
      status: 'completed',
      tool: 'read_file · README.md',
      output: 'Repository structure is ready for the shared session.'
    }
  ],
  lastCompletedAction: {
    tool: 'read_file · README.md',
    output: 'Repository structure is ready for the shared session.'
  },
  providerEvents: [
    {
      id: 'turn-1',
      kind: 'turn',
      label: 'Turn',
      detail: 'Inspect the repository layout.',
      turnId: 'f3100000-0000-4000-8000-000000000003'
    },
    {
      id: 'status-1',
      kind: 'status',
      label: 'Status',
      detail: 'completed',
      turnId: 'f3100000-0000-4000-8000-000000000003'
    },
    {
      id: 'output-1',
      kind: 'output',
      label: 'Output',
      detail: 'Repository structure is ready for the shared session.',
      turnId: 'f3100000-0000-4000-8000-000000000003'
    },
    {
      id: 'tool-1',
      kind: 'tool_call',
      label: 'Tool call',
      detail: 'read_file · README.md',
      turnId: 'f3100000-0000-4000-8000-000000000003'
    },
    {
      id: 'result-1',
      kind: 'tool_result',
      label: 'Tool result',
      detail: 'Repository structure is ready for the shared session.',
      turnId: 'f3100000-0000-4000-8000-000000000003'
    }
  ]
}

describe('CodevSharedSessionViewPanel', () => {
  it('renders metadata, attributed queue, last completed action, and refresh recovery', () => {
    const html = renderToStaticMarkup(
      <CodevSharedSessionViewPanel
        connected
        restored
        viewer={{ id: 'b0200000-0000-4000-8000-000000000012', name: 'Jordan Lee', canCoSteer: true }}
        view={view}
        draftPrompt=""
        busy=""
        message=""
        onDraftChange={() => undefined}
        onRefresh={() => undefined}
        onStartControlled={() => undefined}
        onQueue={() => undefined}
        onInterrupt={() => undefined}
      />
    )
    expect(html).toContain('Shared session')
    expect(html).toContain('openai')
    expect(html).toContain('Alex Morgan')
    expect(html).toContain('agent-alex')
    expect(html).toContain('Interrupted · controlled turn')
    expect(html).toContain('1 queued')
    expect(html).toContain('Jordan Lee')
    expect(html).toContain('authorId b0200000-0000-4000-8000-000000000012')
    expect(html).toContain('Last completed action')
    expect(html).toContain('read_file · README.md')
    expect(html).toContain('Session restored after browser refresh · stream cursor 3 · queued instruction preserved once.')
    expect(html).toContain('Instruction queued')
    expect(html).toContain('Turn interrupted')
    expect(html).toContain('Standardized events')
    expect(html).toContain('Tool call')
    expect(html).toContain('Tool result')
    expect(html).toContain('data-codev-provider-event="turn"')
  })

  it('disables co-steer actions for viewers', () => {
    const html = renderToStaticMarkup(
      <CodevSharedSessionViewPanel
        connected
        restored={false}
        viewer={{ id: 'viewer', name: 'Casey Rivera', canCoSteer: false }}
        view={{ ...view, session: { ...view.session, state: 'running', queue: [] } }}
        draftPrompt="Inspect README.md"
        busy=""
        message=""
        onDraftChange={() => undefined}
        onRefresh={() => undefined}
        onStartControlled={() => undefined}
        onQueue={() => undefined}
        onInterrupt={() => undefined}
      />
    )
    expect(html).toContain('Queue instruction · unavailable')
    expect(html).toContain('Interrupt turn · unavailable')
  })

  it('shows a revoked-connection block without dropping the completed transcript', () => {
    const html = renderToStaticMarkup(
      <CodevSharedSessionViewPanel
        connected
        restored={false}
        viewer={{ id: 'b0200000-0000-4000-8000-000000000012', name: 'Jordan Lee', canCoSteer: true }}
        view={{
          ...view,
          session: { ...view.session, state: 'idle', queue: [] },
          attributedQueue: [],
          connectionBlocked:
            'This OpenAI connection was revoked or is not connected. Reconnect a key in Settings before starting another turn. The existing session is unchanged.'
        }}
        draftPrompt="Inspect README.md"
        busy=""
        message=""
        onDraftChange={() => undefined}
        onRefresh={() => undefined}
        onStartControlled={() => undefined}
        onQueue={() => undefined}
        onInterrupt={() => undefined}
      />
    )
    expect(html).toContain('Provider connection blocked')
    expect(html).toContain('This OpenAI connection was revoked or is not connected')
    expect(html).toContain('Repository structure is ready for the shared session.')
    expect(html).toContain('Queue instruction')
    expect(html).not.toContain('1 queued')
  })

  it('disables queue and interrupt with explanations for the restricted fixture provider', () => {
    const html = renderToStaticMarkup(
      <CodevSharedSessionViewPanel
        connected
        restored={false}
        viewer={{ id: 'b0200000-0000-4000-8000-000000000012', name: 'Jordan Lee', canCoSteer: true }}
        view={{
          ...view,
          session: { ...view.session, provider: 'restricted', state: 'idle', queue: [] },
          attributedQueue: [],
          capabilities: {
            id: 'restricted',
            label: 'Restricted fixture',
            selected: true,
            canQueue: false,
            canInterrupt: false,
            canStartControlled: true,
            queueUnavailable: 'This restricted fixture provider does not support queued instructions.',
            interruptUnavailable:
              'This restricted fixture provider does not support interrupting a turn.',
            startControlledUnavailable: null
          },
          availableProviders: [
            {
              id: 'openai',
              label: 'OpenAI',
              selected: false,
              canQueue: true,
              canInterrupt: true,
              canStartControlled: true,
              queueUnavailable: null,
              interruptUnavailable: null,
              startControlledUnavailable: null
            },
            {
              id: 'restricted',
              label: 'Restricted fixture',
              selected: true,
              canQueue: false,
              canInterrupt: false,
              canStartControlled: true,
              queueUnavailable: 'This restricted fixture provider does not support queued instructions.',
              interruptUnavailable:
                'This restricted fixture provider does not support interrupting a turn.',
              startControlledUnavailable: null
            }
          ]
        }}
        draftPrompt="Inspect README.md"
        busy=""
        message=""
        onDraftChange={() => undefined}
        onRefresh={() => undefined}
        onStartControlled={() => undefined}
        onQueue={() => undefined}
        onInterrupt={() => undefined}
      />
    )
    expect(html).toContain('Provider capabilities')
    expect(html).toContain('Restricted fixture')
    expect(html).toContain('Current provider')
    expect(html).toContain('Use OpenAI')
    expect(html).toContain('Queue · unavailable')
    expect(html).toContain('Interrupt · unavailable')
    expect(html).toContain('Queue instruction · unavailable')
    expect(html).toContain('Interrupt turn · unavailable')
    expect(html).toContain('This restricted fixture provider does not support queued instructions.')
    expect(html).toContain('This restricted fixture provider does not support interrupting a turn.')
    expect(html).toContain('data-codev-provider-capability="restricted"')
  })

  it('renders a provider boundary after a completed fixture turn', () => {
    const html = renderToStaticMarkup(
      <CodevSharedSessionViewPanel
        connected
        restored={false}
        viewer={{ id: 'b0200000-0000-4000-8000-000000000012', name: 'Jordan Lee', canCoSteer: true }}
        view={{
          ...view,
          session: { ...view.session, provider: 'openai', state: 'idle', queue: [] },
          attributedQueue: [],
          transcript: [
            {
              ...view.transcript[0]!,
              provider: 'restricted',
              providerLabel: 'Restricted fixture'
            }
          ],
          providerBoundaries: [
            {
              id: 'boundary-1',
              from: 'restricted',
              to: 'openai',
              fromLabel: 'Restricted fixture',
              toLabel: 'OpenAI',
              afterTurnId: view.transcript[0]!.turnId,
              label: 'Provider boundary · switched from Restricted fixture to OpenAI'
            }
          ]
        }}
        draftPrompt=""
        busy=""
        message=""
        onDraftChange={() => undefined}
        onRefresh={() => undefined}
        onStartControlled={() => undefined}
        onQueue={() => undefined}
        onInterrupt={() => undefined}
      />
    )
    expect(html).toContain('Restricted fixture')
    expect(html).toContain('Provider boundary · switched from Restricted fixture to OpenAI')
    expect(html).toContain('data-codev-provider-boundary="restricted-to-openai"')
  })
})
