import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { startCodevManagedAgent } from '@/web/codev-managed-agent'

export function useCodevVaultManagedAgent(
  activeWorktreeId: string | null,
  repoId: string | null,
  onReady: () => void
): { creating: boolean; createProposal: () => void } {
  const [creating, setCreating] = useState(false)
  const createProposal = useCallback(() => {
    setCreating(true)
    void startCodevManagedAgent({
      baseWorktreeId: activeWorktreeId,
      repoId
    })
      .then(() => {
        onReady()
        toast.success('CoDev agent ready', {
          description: 'Use Agents to queue its first instruction.'
        })
      })
      .catch((error: unknown) => {
        toast.error('Failed to prepare managed proposal', {
          description: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => setCreating(false))
  }, [activeWorktreeId, onReady, repoId])
  return { creating, createProposal }
}
