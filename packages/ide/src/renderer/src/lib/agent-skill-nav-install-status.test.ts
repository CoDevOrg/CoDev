import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  SkillFreshnessInstallation,
  SkillFreshnessInventory,
  SkillFreshnessStatus
} from '../../../shared/skill-freshness'
import { getAgentSkillNavInstallStatus } from './agent-skill-nav-install-status'

function placement(name: string, status: SkillFreshnessStatus): SkillFreshnessInstallation {
  const unresolvedPath = path.join('home', 'test', '.agents', 'skills', name)
  return {
    id: name,
    name,
    rootId: 'home-agents',
    providers: ['agent-skills'],
    sourceKind: 'home',
    sourceLabel: 'Agent skills home',
    unresolvedPath,
    resolvedPath: unresolvedPath,
    physicalIdentity: name,
    topology: 'canonical-copy',
    status,
    installedReleaseRevision: 1,
    installedAppVersion: '1.0.0',
    currentReleaseRevision: 2,
    currentPackageDigest: 'current',
    currentAppVersion: '2.0.0',
    observedPackageDigest: status === 'current' ? 'current' : 'other',
    errorCategory: null
  }
}

function inventory(
  installations: SkillFreshnessInstallation[],
  eligibleUpdateNames: string[] = []
): SkillFreshnessInventory {
  return { schemaVersion: 1, installations, eligibleUpdateNames, scanIssues: [], scannedAt: 1 }
}

describe('getAgentSkillNavInstallStatus', () => {
  it('keeps loading and missing states ahead of freshness', () => {
    expect(
      getAgentSkillNavInstallStatus({
        name: 'orca-linear',
        installed: true,
        loading: true,
        inventory: inventory([placement('orca-linear', 'current')])
      })
    ).toBe('checking')
    expect(
      getAgentSkillNavInstallStatus({
        name: 'orca-linear',
        installed: false,
        loading: false,
        inventory: null
      })
    ).toBe('install')
  })
})
