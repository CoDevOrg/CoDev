import { useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge
} from '@/web/codev-bridge-singleton'

export type CodevCursorMember = {
  user: { id: string; login: string; name: string | null }
  path: string | null
  cursor: { anchor: number; head: number } | null
}

type PresencePayload = {
  viewerId?: string
  members?: CodevCursorMember[]
}

export const CURSOR_HEARTBEAT_MS = 20_000

function memberLabel(member: CodevCursorMember): string {
  return member.user.name?.trim() || member.user.login
}

export function selectRemoteCursors(
  members: CodevCursorMember[],
  viewerId: string | null,
  path: string
): CodevCursorMember[] {
  return members.filter(
    (member) =>
      viewerId !== null &&
      member.user.id !== viewerId &&
      member.path === path &&
      member.cursor !== null
  )
}

function cursorDecorations(
  editorInstance: editor.IStandaloneCodeEditor,
  members: CodevCursorMember[]
): editor.IModelDeltaDecoration[] {
  const model = editorInstance.getModel()
  if (!model) return []
  const maxOffset = model.getValueLength()
  return members.flatMap((member) => {
    const cursor = member.cursor
    if (!cursor) return []
    const anchor = Math.min(cursor.anchor, maxOffset)
    const head = Math.min(cursor.head, maxOffset)
    const start = model.getPositionAt(Math.min(anchor, head))
    const end = model.getPositionAt(Math.max(anchor, head))
    const caret = model.getPositionAt(head)
    const label = memberLabel(member)
    const result: editor.IModelDeltaDecoration[] = [
      {
        range: {
          startLineNumber: caret.lineNumber,
          startColumn: caret.column,
          endLineNumber: caret.lineNumber,
          endColumn: caret.column
        },
        options: {
          afterContentClassName: 'codev-remote-cursor',
          hoverMessage: { value: `${label}'s cursor` }
        }
      }
    ]
    if (anchor !== head) {
      result.push({
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column
        },
        options: {
          inlineClassName: 'codev-remote-selection',
          hoverMessage: { value: `${label}'s selection` }
        }
      })
    }
    return result
  })
}

export function useCodevCursorDecorations({
  editor: editorInstance,
  relativePath
}: {
  editor: editor.IStandaloneCodeEditor | null
  relativePath: string
}): void {
  const [connected, setConnected] = useState(
    () => getCodevBridgeSnapshot().status === 'connected'
  )
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [members, setMembers] = useState<CodevCursorMember[]>([])
  const lastCursorRef = useRef('')
  const decorationIdsRef = useRef<string[]>([])

  useEffect(
    () => subscribeCodevBridge(() => setConnected(getCodevBridgeSnapshot().status === 'connected')),
    []
  )

  useEffect(() => {
    if (!editorInstance || !relativePath || !connected) return
    let disposed = false
    const refresh = (): void => {
      void requestCodevBridge<PresencePayload>('presence.list')
        .then((payload) => {
          if (disposed) return
          setViewerId(typeof payload.viewerId === 'string' ? payload.viewerId : null)
          setMembers(Array.isArray(payload.members) ? payload.members : [])
        })
        .catch(() => {
          if (!disposed) setMembers([])
        })
    }
    const publishSelection = (force = false): void => {
      const model = editorInstance.getModel()
      const selection = editorInstance.getSelection()
      if (!model || !selection) return
      const cursor = {
        anchor: model.getOffsetAt(selection.getSelectionStart()),
        head: model.getOffsetAt(selection.getPosition())
      }
      const key = `${relativePath}:${cursor.anchor}:${cursor.head}`
      if (!force && key === lastCursorRef.current) return
      void requestCodevBridge('presence.cursor.update', { path: relativePath, cursor })
        .then(() => {
          lastCursorRef.current = key
        })
        .catch(() => undefined)
    }
    refresh()
    publishSelection()
    const selectionSubscription = editorInstance.onDidChangeCursorSelection(() => publishSelection())
    const cursorHeartbeat = window.setInterval(() => publishSelection(true), CURSOR_HEARTBEAT_MS)
    const poll = window.setInterval(refresh, 1_000)
    return () => {
      disposed = true
      selectionSubscription.dispose()
      window.clearInterval(cursorHeartbeat)
      window.clearInterval(poll)
    }
  }, [connected, editorInstance, relativePath])

  useEffect(() => {
    if (!editorInstance) return
    const remote = selectRemoteCursors(members, viewerId, relativePath)
    decorationIdsRef.current = editorInstance.deltaDecorations(
      decorationIdsRef.current,
      cursorDecorations(editorInstance, remote)
    )
    return () => {
      decorationIdsRef.current = editorInstance.deltaDecorations(decorationIdsRef.current, [])
    }
  }, [editorInstance, members, relativePath, viewerId])
}
