import {
  recognizeAgentProcessFromCommandLine,
  type RecognizedAgentProcess
} from './agent-process-recognition'
import { getSyntheticAgentTitleProfile } from './synthetic-agent-title'

export type ForegroundAgentCandidate = {
  pid: number
  ppid: number
  command: string
  name?: string
}

export function shouldInspectOuterWrapperForegroundProcess(
  process: RecognizedAgentProcess
): boolean {
  // Why: no shipped agent is embedded by a same-title-group wrapper; scanning
  // ancestors would add a subprocess to every foreground poll for nothing.
  return getSyntheticAgentTitleProfile(process.agent)?.titleIdentityGroup !== undefined
}

/**
 * Collapse a foreground read onto its outermost same-title-group ancestor.
 * Why: OMP embeds Pi, while depth alone cannot distinguish wrappers from sibling jobs.
 */
export function resolveOuterWrapperForegroundProcess(
  winner: RecognizedAgentProcess,
  winnerCandidate: ForegroundAgentCandidate,
  descendants: readonly ForegroundAgentCandidate[]
): string {
  const winnerGroup = getSyntheticAgentTitleProfile(winner.agent)?.titleIdentityGroup
  if (!winnerGroup) {
    return winner.processName
  }
  const candidatesByPid = new Map(descendants.map((candidate) => [candidate.pid, candidate]))
  const seen = new Set<number>([winnerCandidate.pid])
  let outerProcessName = winner.processName
  let parentPid = winnerCandidate.ppid
  while (!seen.has(parentPid)) {
    seen.add(parentPid)
    const candidate = candidatesByPid.get(parentPid)
    if (!candidate) {
      break
    }
    const recognized =
      recognizeAgentProcessFromCommandLine(candidate.command) ??
      recognizeAgentProcessFromCommandLine(candidate.name)
    if (
      recognized &&
      getSyntheticAgentTitleProfile(recognized.agent)?.titleIdentityGroup === winnerGroup
    ) {
      outerProcessName = recognized.processName
    }
    parentPid = candidate.ppid
  }
  return outerProcessName
}
