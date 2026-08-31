// CoDev-only. Paints a coloured marker in the open file for every agent that is
// editing it right now, so a room watching the workspace sees several agents
// writing in parallel instead of guessing from the sidebar. Sibling to
// `codev-cursor-decorations.ts` (which does the same for human collaborators);
// the signal here is the live agent-status map, not the presence bridge.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { useShallow } from 'zustand/react/shallow'

import { useAppStore } from '@/store'
import { isCodevEmbedded } from '@/web/codev-embedded'
import { selectLiveAgentStatusEntriesForWorktree } from '@/components/sidebar/worktree-agent-row-selectors'
import {
  codevAgentPresenceColor,
  selectCodevLiveEdits,
  type CodevAgentFilePresence,
} from '@/web/codev-live-edit-presence'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'

// Why: presence expires on a timer (see CODEV_LIVE_EDIT_TTL_MS), so re-project on
// this cadence while any agent is live to retire a finished agent's marker.
const CODEV_AGENT_EDIT_TICK_MS = 2_000
const EMPTY_ENTRIES: readonly AgentStatusEntry[] = []

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  'claude-agent-teams': 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini',
  grok: 'Grok',
  opencode: 'OpenCode',
}

export function codevAgentEditLabel(agentKind: string): string {
  if (agentKind in AGENT_LABELS) {
    return AGENT_LABELS[agentKind]!
  }
  return agentKind
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** CSS-safe suffix for the per-kind decoration class. */
export function codevAgentEditKindClass(agentKind: string): string {
  const slug = agentKind.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `codev-agent-edit--${slug || 'other'}`
}

function ensureKindStyleElement(ref: { current: HTMLStyleElement | null }): HTMLStyleElement {
  if (!ref.current) {
    const element = document.createElement('style')
    element.dataset.codevAgentEdit = 'true'
    document.head.append(element)
    ref.current = element
  }
  return ref.current
}

/** One rule per agent kind currently on screen: tints the line, glyph, and label. */
export function buildCodevAgentEditKindCss(agentKinds: readonly string[]): string {
  return [...new Set(agentKinds)]
    .map((kind) => {
      const cls = codevAgentEditKindClass(kind)
      const color = codevAgentPresenceColor(kind)
      return [
        `.monaco-editor .${cls}.codev-agent-edit-line { background: color-mix(in srgb, ${color} 14%, transparent); box-shadow: inset 2px 0 0 ${color}; }`,
        `.monaco-editor .${cls}.codev-agent-edit-glyph { background: ${color}; }`,
        `.monaco-editor .${cls}.codev-agent-edit-label { color: ${color}; border-color: color-mix(in srgb, ${color} 45%, transparent); }`,
      ].join('\n')
    })
    .join('\n')
}

export function buildCodevAgentEditDecorations(
  editorInstance: editor.IStandaloneCodeEditor,
  agents: readonly CodevAgentFilePresence[],
): editor.IModelDeltaDecoration[] {
  const model = editorInstance.getModel()
  if (!model) {
    return []
  }
  const maxLine = model.getLineCount()
  return agents.map((agent) => {
    const start = Math.min(Math.max(agent.startLine ?? 1, 1), maxLine)
    const end = Math.min(Math.max(agent.endLine ?? start, start), maxLine)
    const cls = codevAgentEditKindClass(agent.agentKind)
    const label = codevAgentEditLabel(agent.agentKind)
    return {
      range: {
        startLineNumber: start,
        startColumn: 1,
        endLineNumber: end,
        endColumn: 1,
      },
      options: {
        isWholeLine: true,
        className: `codev-agent-edit-line ${cls}`,
        linesDecorationsClassName: `codev-agent-edit-glyph ${cls}`,
        hoverMessage: { value: `${label} is editing this file` },
        after: {
          content: ` ${label} editing`,
          inlineClassName: `codev-agent-edit-label ${cls}`,
        },
      },
    }
  })
}

export function useCodevAgentEditDecorations({
  editor: editorInstance,
  relativePath,
  worktreeId,
}: {
  editor: editor.IStandaloneCodeEditor | null
  relativePath: string
  worktreeId?: string
}): void {
  const embedded = useMemo(() => isCodevEmbedded(), [])
  const active = embedded && Boolean(worktreeId)

  const entries = useAppStore(
    useShallow((state) =>
      active
        ? selectLiveAgentStatusEntriesForWorktree(state, worktreeId as string)
        : EMPTY_ENTRIES,
    ),
  )

  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!active || entries.length === 0) {
      return
    }
    const timer = window.setInterval(() => setNowTick(Date.now()), CODEV_AGENT_EDIT_TICK_MS)
    return () => window.clearInterval(timer)
  }, [active, entries.length])

  const agentsInFile = useMemo<CodevAgentFilePresence[]>(() => {
    if (!active || entries.length === 0) {
      return []
    }
    const byPaneKey: Record<string, AgentStatusEntry> = {}
    for (const entry of entries) {
      byPaneKey[entry.paneKey] = entry
    }
    return selectCodevLiveEdits(byPaneKey, nowTick).filter(
      (row) => row.filePath === relativePath,
    )
  }, [active, entries, nowTick, relativePath])

  const kindStyleRef = useRef<HTMLStyleElement | null>(null)
  useEffect(() => {
    if (agentsInFile.length === 0) {
      return
    }
    ensureKindStyleElement(kindStyleRef).textContent = buildCodevAgentEditKindCss(
      agentsInFile.map((agent) => agent.agentKind),
    )
  }, [agentsInFile])
  useEffect(
    () => () => {
      kindStyleRef.current?.remove()
      kindStyleRef.current = null
    },
    [],
  )

  const decorationIdsRef = useRef<string[]>([])
  useEffect(() => {
    if (!editorInstance) {
      return
    }
    decorationIdsRef.current = editorInstance.deltaDecorations(
      decorationIdsRef.current,
      buildCodevAgentEditDecorations(editorInstance, agentsInFile),
    )
    return () => {
      if (editorInstance.getModel()) {
        decorationIdsRef.current = editorInstance.deltaDecorations(decorationIdsRef.current, [])
      }
    }
  }, [editorInstance, agentsInFile])
}
