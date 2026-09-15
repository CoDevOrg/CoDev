import { describe, expect, it } from 'vitest'
import type { DiscoveredSkill, SkillDiscoverySource } from '../../../shared/skills'
import type { } from '../../../shared/types'
import {
  agentHasOrchestrationSkill,
} from './orchestration-skill-coverage'

function skill(overrides: Partial<DiscoveredSkill>): DiscoveredSkill {
  return {
    id: 'skill-1',
    name: 'orchestration',
    description: null,
    providers: ['agent-skills'],
    sourceKind: 'home',
    sourceLabel: 'Agent skills home',
    rootPath: '/Users/test/.agents/skills',
    directoryPath: '/Users/test/.agents/skills/orchestration',
    skillFilePath: '/Users/test/.agents/skills/orchestration/SKILL.md',
    installed: true,
    fileCount: 1,
    updatedAt: null,
    ...overrides
  }
}

function source(
  path: string,
  owner: SkillDiscoverySource['owner'],
  sourceKind: SkillDiscoverySource['sourceKind'] = 'home'
): SkillDiscoverySource {
  return {
    id: path,
    label: path,
    path,
    sourceKind,
    providers: ['agent-skills'],
    owner,
    exists: true
  }
}

describe('orchestration skill agent coverage', () => {

  it('marks Codex from plugin cache installs', () => {
    expect(
      agentHasOrchestrationSkill(
        'codex',
        [
          skill({
            providers: ['codex', 'agent-skills'],
            sourceKind: 'plugin',
            sourceLabel: 'Codex plugin cache',
            rootPath: '/Users/test/.codex/plugins/cache',
            directoryPath: '/Users/test/.codex/plugins/cache/vendor/orchestration'
          })
        ],
        [source('/Users/test/.codex/plugins/cache', 'codex', 'plugin')]
      )
    ).toBe(true)
  })

  it('marks Claude from an enabled plugin install', () => {
    // Why: Claude Code loads skills from enabled plugins, so an owned plugin root
    // counts the same as the Codex plugin cache does.
    expect(
      agentHasOrchestrationSkill(
        'claude',
        [
          skill({
            providers: ['claude', 'agent-skills'],
            sourceKind: 'plugin',
            sourceLabel: 'Claude plugin',
            rootPath: '/Users/test/.claude/plugins/repos/vendor/pack/skills',
            directoryPath: '/Users/test/.claude/plugins/repos/vendor/pack/skills/orchestration'
          })
        ],
        [source('/Users/test/.claude/plugins/repos/vendor/pack/skills', 'claude', 'plugin')]
      )
    ).toBe(true)
  })

  it('matches orchestration by directory name when frontmatter uses a display name', () => {
    expect(
      agentHasOrchestrationSkill(
        'claude',
        [
          skill({
            name: 'Orca Orchestration',
            providers: ['claude'],
            sourceKind: 'home',
            rootPath: '/Users/test/.claude/skills',
            directoryPath: '/Users/test/.claude/skills/orchestration'
          })
        ],
        [source('/Users/test/.claude/skills', 'claude')]
      )
    ).toBe(true)
  })

  it('keeps the owning home root when a repo root duplicates its path', () => {
    // Why: a workspace whose cwd is the home dir scans ~/.claude/skills as both a
    // home and a repo root, and the repo duplicate sorts last by label.
    const skills = [
      skill({
        providers: ['claude'],
        sourceKind: 'home',
        rootPath: '/Users/test/.claude/skills',
        directoryPath: '/Users/test/.claude/skills/orchestration'
      })
    ]

    expect(
      agentHasOrchestrationSkill('claude', skills, [
        source('/Users/test/.claude/skills', 'claude'),
        source('/Users/test/.claude/skills', 'claude', 'repo')
      ])
    ).toBe(true)
  })

  it('leaves an agent uncovered when no source claims the skill root', () => {
    const skills = [
      skill({
        providers: ['claude'],
        sourceKind: 'home',
        rootPath: '/Users/test/.claude/skills',
        directoryPath: '/Users/test/.claude/skills/orchestration'
      })
    ]

    expect(agentHasOrchestrationSkill('claude', skills, [])).toBe(false)
  })

  it('marks Claude Agent Teams from ~/.claude/skills like Claude Code', () => {
    const skills = [
      skill({
        providers: ['claude'],
        sourceKind: 'home',
        rootPath: '/Users/test/.claude/skills',
        directoryPath: '/Users/test/.claude/skills/orchestration'
      })
    ]

    expect(
      agentHasOrchestrationSkill('claude-agent-teams', skills, [
        source('/Users/test/.claude/skills', 'claude')
      ])
    ).toBe(true)
  })

  it('marks Windows skill paths', () => {
    expect(
      agentHasOrchestrationSkill(
        'codex',
        [
          skill({
            providers: ['codex'],
            sourceKind: 'home',
            rootPath: 'C:\\Users\\test\\.codex\\skills',
            directoryPath: 'C:\\Users\\test\\.codex\\skills\\orchestration'
          })
        ],
        [source('C:\\Users\\test\\.codex\\skills', 'codex')]
      )
    ).toBe(true)
  })
})
