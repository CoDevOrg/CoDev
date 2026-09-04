import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { codevDefaultChatAgent } from '@/web/codev-default-chat-tab'
import { requestCodevBridge } from '@/web/codev-bridge-singleton'

type WorkboardSlot = {
  occupied?: boolean
  sessionId?: string | null
  worktreeId?: string | null
}

/**
 * The managed session that owns `worktreeId`, or null when the workboard does
 * not know of one. Read at click time rather than held in state: the caller is
 * a sidebar list, not the agent roster, and one call on a deliberate action is
 * cheaper than another poll.
 */
async function findManagedSessionId(worktreeId: string): Promise<string | null> {
  try {
    const snapshot = await requestCodevBridge<{ slots?: WorkboardSlot[] }>('workboard.list')
    return (
      snapshot?.slots?.find(
        (slot) => slot.occupied && slot.sessionId && slot.worktreeId === worktreeId
      )?.sessionId ?? null
    )
  } catch {
    // The local chat opens either way; only the room's record of it is lost.
    return null
  }
}

/**
 * Starts a fresh chat on the agent that owns the worktree the member is
 * looking at: same branch, same files, empty context. It is the escape hatch
 * from a thread that has grown too long to steer, and it reuses the worktree,
 * so it costs no capacity slot.
 *
 * This lives outside the Mission Control panel because the chat list moved to
 * the left sidebar, where a member looking at their chats is exactly who wants
 * to start another one.
 */
export function useCodevNewChat({
  onStarted
}: {
  onStarted?: () => void
} = {}): {
  startNewChat: () => Promise<void>
  pending: boolean
  canStart: boolean
} {
  const [pending, setPending] = useState(false)
  const worktreeId = useAppStore((state) => state.activeWorktreeId) ?? null

  const startNewChat = useCallback(async () => {
    if (!worktreeId || pending) {
      return
    }
    const agent = codevDefaultChatAgent()
    if (!agent) {
      return
    }
    setPending(true)
    try {
      launchAgentInNewTab({ agent, worktreeId })
      const sessionId = await findManagedSessionId(worktreeId)
      if (sessionId) {
        // Best effort: the chat is already open locally either way, and a
        // failure here only costs the room's view of it.
        await requestCodevBridge('agents.newChat', { sessionId }).catch(() => undefined)
        onStarted?.()
      }
      toast.success('Started a fresh chat on this agent', {
        description: 'Same branch and files, empty context.'
      })
    } catch (error: unknown) {
      toast.error('Could not start a new chat', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setPending(false)
    }
  }, [onStarted, pending, worktreeId])

  return { startNewChat, pending, canStart: Boolean(worktreeId) }
}
