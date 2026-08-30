import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CODEV_AGENT_MEMBER_ENV,
  resolveCodevMemberAgentEnv
} from './codev-member-agent-env'

const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'

let home: string

async function fileMemberEnv(memberId: string, env: Record<string, string>): Promise<void> {
  const dir = join(home, '.codev', 'agents', memberId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'env.json'), JSON.stringify(env))
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'codev-member-env-'))
})

describe('resolveCodevMemberAgentEnv', () => {
  it('passes a launch without the marker through untouched', async () => {
    const env = { TERM: 'xterm' }
    expect(await resolveCodevMemberAgentEnv(env, home)).toEqual(env)
    expect(await resolveCodevMemberAgentEnv(undefined, home)).toBeUndefined()
  })

  it('gives each member their own credentials from one shared home', async () => {
    await fileMemberEnv(ALICE, { CLAUDE_CODE_OAUTH_TOKEN: 'alice-token' })
    await fileMemberEnv(BOB, { CLAUDE_CODE_OAUTH_TOKEN: 'bob-token' })

    const alice = await resolveCodevMemberAgentEnv(
      { [CODEV_AGENT_MEMBER_ENV]: ALICE, TERM: 'xterm' },
      home
    )
    const bob = await resolveCodevMemberAgentEnv({ [CODEV_AGENT_MEMBER_ENV]: BOB }, home)

    expect(alice).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'alice-token', TERM: 'xterm' })
    expect(bob).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'bob-token' })
  })

  it('always strips the marker so it never reaches the agent process', async () => {
    await fileMemberEnv(ALICE, { CODEX_HOME: '/home/ws/.codev/agents/a/codex' })
    for (const env of [
      { [CODEV_AGENT_MEMBER_ENV]: ALICE },
      { [CODEV_AGENT_MEMBER_ENV]: 'not-a-uuid' },
      { [CODEV_AGENT_MEMBER_ENV]: BOB } // linked nothing: no bundle on disk
    ]) {
      const resolved = await resolveCodevMemberAgentEnv(env, home)
      expect(resolved).not.toHaveProperty(CODEV_AGENT_MEMBER_ENV)
    }
  })

  it('refuses a member id that could escape the agents directory', async () => {
    await fileMemberEnv(ALICE, { CLAUDE_CODE_OAUTH_TOKEN: 'alice-token' })
    expect(
      await resolveCodevMemberAgentEnv(
        { [CODEV_AGENT_MEMBER_ENV]: `../../${ALICE}` },
        home
      )
    ).toEqual({})
  })

  it('launches unauthenticated rather than failing when a member has no bundle', async () => {
    expect(
      await resolveCodevMemberAgentEnv({ [CODEV_AGENT_MEMBER_ENV]: ALICE, TERM: 'xterm' }, home)
    ).toEqual({ TERM: 'xterm' })
  })

  it('never lets a filed credential override an explicit launch value', async () => {
    await fileMemberEnv(ALICE, { ANTHROPIC_API_KEY: 'filed', CODEX_HOME: '/filed' })
    expect(
      await resolveCodevMemberAgentEnv(
        { [CODEV_AGENT_MEMBER_ENV]: ALICE, ANTHROPIC_API_KEY: 'explicit' },
        home
      )
    ).toEqual({ ANTHROPIC_API_KEY: 'explicit', CODEX_HOME: '/filed' })
  })

  it('ignores a corrupt bundle instead of throwing', async () => {
    const dir = join(home, '.codev', 'agents', ALICE)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'env.json'), 'not json')
    expect(
      await resolveCodevMemberAgentEnv({ [CODEV_AGENT_MEMBER_ENV]: ALICE, TERM: 'x' }, home)
    ).toEqual({ TERM: 'x' })
  })
})
