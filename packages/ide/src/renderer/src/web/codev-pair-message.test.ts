import { describe, expect, it } from 'vitest'
import { parseCodevPairMessage, readCodevPendingEmbed } from './codev-pair-message'

const WORKSPACE_PATH = '/srv/codev/workspaces/fee6f828-8275-40b3-9101-b9cc1d809562'
const MEMBER_ID = '11111111-2222-4333-8444-555555555555'

describe('readCodevPendingEmbed', () => {
  it('is true only for codev=1 with codevPending=1', () => {
    expect(readCodevPendingEmbed({ hash: '#codev=1&codevPending=1' })).toBe(true)
    expect(readCodevPendingEmbed({ hash: '#codev=1&codevProjectKind=git' })).toBe(false)
    expect(readCodevPendingEmbed({ hash: '#codevPending=1' })).toBe(false)
    expect(readCodevPendingEmbed({ hash: '' })).toBe(false)
  })
})

describe('parseCodevPairMessage', () => {
  const valid = {
    type: 'codev:pair',
    pairing: 'b64offer',
    projectPath: WORKSPACE_PATH,
    projectKind: 'git',
    projectName: 'CoDevOrg/CoDev',
    defaultAgent: 'codex',
    memberId: MEMBER_ID,
    cursorAvailable: true
  }

  it('accepts a well-formed message and carries the bootstrap through', () => {
    expect(parseCodevPairMessage(valid)).toEqual({
      pairing: 'b64offer',
      bootstrap: {
        projectPath: WORKSPACE_PATH,
        projectKind: 'git',
        projectName: 'CoDevOrg/CoDev',
        defaultAgent: 'codex',
        memberId: MEMBER_ID,
        cursorAvailable: true
      }
    })
  })

  it('drops optional fields that fail validation without rejecting the message', () => {
    const payload = parseCodevPairMessage({
      ...valid,
      projectName: 'not a repo slug',
      defaultAgent: 'grok',
      memberId: 'nope',
      cursorAvailable: 'yes'
    })
    expect(payload).toEqual({
      pairing: 'b64offer',
      bootstrap: { projectPath: WORKSPACE_PATH, projectKind: 'git' }
    })
  })

  it('rejects the message outright on a bad type, pairing, path, or kind', () => {
    expect(parseCodevPairMessage({ ...valid, type: 'codev:other' })).toBeNull()
    expect(parseCodevPairMessage({ ...valid, pairing: '   ' })).toBeNull()
    expect(parseCodevPairMessage({ ...valid, projectPath: '/etc/passwd' })).toBeNull()
    expect(parseCodevPairMessage({ ...valid, projectKind: 'svn' })).toBeNull()
    expect(parseCodevPairMessage(null)).toBeNull()
    expect(parseCodevPairMessage('codev:pair')).toBeNull()
  })
})
