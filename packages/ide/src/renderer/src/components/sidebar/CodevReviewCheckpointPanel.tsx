import { useCallback, useEffect, useState, type JSX } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge
} from '../../web/codev-bridge-singleton'
import { getCodevProposalWorktreeId } from '../../web/codev-proposal-discard'
import {
  CodevReviewCheckpointViewPanel,
  selectCodevReviewCheckpoint,
  type CodevReviewSnapshot
} from './CodevReviewCheckpointView'

export { CodevReviewCheckpointViewPanel, type CodevReviewSnapshot } from './CodevReviewCheckpointView'

let sharedDiffOpen = false

export function CodevReviewCheckpointPanel({
  surface
}: {
  surface: 'source-control' | 'checks'
}): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const activeWorktree = useActiveWorktree()
  const setRightSidebarTab = useAppStore((s) => s.setRightSidebarTab)
  const worktreeId = activeWorktree
    ? getCodevProposalWorktreeId(activeWorktree.path, activeWorktree.comment)
    : null
  const [bridge, setBridge] = useState(() => getCodevBridgeSnapshot())
  const [snapshot, setSnapshot] = useState<CodevReviewSnapshot | null>(null)
  const [busy, setBusy] = useState('')
  const [diffOpen, setDiffOpen] = useState(sharedDiffOpen)

  useEffect(() => {
    return subscribeCodevBridge(() => {
      setBridge(getCodevBridgeSnapshot())
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!embedded || bridge.status !== 'connected') return
    setBusy('refresh')
    try {
      const result = await requestCodevBridge<CodevReviewSnapshot>('review.list')
      setSnapshot(result)
    } catch (error: unknown) {
      toast.error('Failed to load review checkpoint', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy('')
    }
  }, [bridge.status, embedded])

  useEffect(() => {
    if (!embedded || bridge.status !== 'connected') return
    void refresh()
  }, [bridge.status, embedded, refresh])

  if (!embedded) {
    return null
  }

  const checkpoint = selectCodevReviewCheckpoint(snapshot?.checkpoints ?? [], worktreeId)
  const canReview = Boolean(snapshot?.viewer?.canReview)
  const canMerge = Boolean(snapshot?.viewer?.canMerge)

  return (
    <CodevReviewCheckpointViewPanel
      surface={surface}
      connected={bridge.status === 'connected'}
      snapshot={snapshot}
      checkpoint={checkpoint}
      busy={busy}
      canReview={canReview}
      canMerge={canMerge}
      diffOpen={diffOpen}
      onRefresh={() => {
        void refresh()
      }}
      onPrepare={() => {
        const sessionId = checkpoint?.sessionId
        if (!sessionId) return
        setBusy('prepare')
        void requestCodevBridge<CodevReviewSnapshot>('review.prepare', { sessionId })
          .then((result) => {
            setSnapshot(result)
          })
          .catch((error: unknown) => {
            toast.error('Failed to mark review-ready', {
              description: error instanceof Error ? error.message : String(error)
            })
          })
          .finally(() => {
            setBusy('')
          })
      }}
      onAdvance={() => {
        setBusy('advance')
        void requestCodevBridge<CodevReviewSnapshot>('review.advance')
          .then((result) => {
            setSnapshot(result)
          })
          .catch((error: unknown) => {
            toast.error('Failed to advance integration head', {
              description: error instanceof Error ? error.message : String(error)
            })
          })
          .finally(() => {
            setBusy('')
          })
      }}
      onMerge={() => {
        const sessionId = checkpoint?.sessionId
        if (!sessionId) return
        setBusy('merge')
        void requestCodevBridge<CodevReviewSnapshot>('review.merge', { sessionId })
          .then((result) => {
            setSnapshot(result)
          })
          .catch((error: unknown) => {
            toast.error('Failed to integrate checkpoint', {
              description: error instanceof Error ? error.message : String(error)
            })
          })
          .finally(() => {
            setBusy('')
          })
      }}
      onOpenDiff={() => {
        sharedDiffOpen = true
        setDiffOpen(true)
        if (surface === 'source-control') {
          setRightSidebarTab('checks')
        }
      }}
    />
  )
}
