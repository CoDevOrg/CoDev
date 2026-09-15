import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importExternalPathsToRuntime } from './runtime-file-client'
import {
  clearRuntimeCompatibilityCacheForTests,
  markRuntimeEnvironmentCompatible
} from './runtime-rpc-client'
import { replaceRuntimeEnvironmentRevisions } from './runtime-environment-revision'
import {
  FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY,
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  RUNTIME_PROTOCOL_VERSION
} from '../../../shared/protocol-version'

const ENVIRONMENT_ID = 'env-repaired'
const CAPTURED_REVISION = 41
const REPLACEMENT_REVISION = 42
const runtimeEnvironmentCall = vi.fn()
const stageExternalPathsForRuntimeUpload = vi.fn()
const importExternalPaths = vi.fn()

type RuntimeCallArgs = {
  selector: string
  method: string
  params?: Record<string, unknown>
  timeoutMs?: number
  expectedEnvironmentPairingRevision?: number
}

const hubLocalContext = {
  settings: { activeRuntimeEnvironmentId: ENVIRONMENT_ID },
  worktreeId: 'wt-hub-local',
  worktreePath: '/hub/repo',
  expectedExecutionHostId: 'local' as const
}

function setEnvironmentRevision(pairingRevision: number): void {
  replaceRuntimeEnvironmentRevisions([{ id: ENVIRONMENT_ID, createdAt: 1, pairingRevision }])
}

function runtimeStatusResponse() {
  return {
    id: 'status',
    ok: true,
    result: {
      runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
      minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
      capabilities: [FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY]
    },
    _meta: { runtimeId: 'hub-runtime' }
  }
}

function successfulRuntimeResponse(method: string) {
  return {
    id: method,
    ok: true,
    result: { ok: true },
    _meta: { runtimeId: 'hub-runtime' }
  }
}

function missingRuntimePathResponse() {
  return {
    id: 'files.stat',
    ok: false,
    error: { code: 'not_found', message: 'not found' },
    _meta: { runtimeId: 'hub-runtime' }
  }
}

function repairedRuntimeResponse(method: string) {
  return {
    id: method,
    ok: false,
    error: {
      code: 'runtime_environment_repaired',
      message: 'Runtime environment was re-paired during the import.'
    },
    _meta: { runtimeId: 'replacement-hub-runtime' }
  }
}

function mockStagedFile(sourcePath: string, name: string, contentBase64: string): void {
  stageExternalPathsForRuntimeUpload.mockResolvedValue({
    sources: [
      {
        sourcePath,
        status: 'staged',
        name,
        kind: 'file',
        entries: [{ relativePath: '', kind: 'file', contentBase64 }]
      }
    ]
  })
}

function expectEveryRuntimeCallBoundToCapturedRevision(): void {
  expect(runtimeEnvironmentCall).toHaveBeenCalled()
  for (const [args] of runtimeEnvironmentCall.mock.calls as [RuntimeCallArgs][]) {
    expect(args.selector).toBe(ENVIRONMENT_ID)
    expect(args.expectedEnvironmentPairingRevision).toBe(CAPTURED_REVISION)
  }
}

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  setEnvironmentRevision(CAPTURED_REVISION)
  markRuntimeEnvironmentCompatible(ENVIRONMENT_ID)
  runtimeEnvironmentCall.mockReset()
  stageExternalPathsForRuntimeUpload.mockReset()
  importExternalPaths.mockReset()
  vi.stubGlobal('window', {
    api: {
      fs: {
        importExternalPaths,
        stageExternalPathsForRuntimeUpload
      },
      runtimeEnvironments: {
        call: runtimeEnvironmentCall
      }
    }
  })
})

describe('runtime file import pairing revision', () => {

  it('keeps a HUB-local composer commit on its entry revision when re-paired mid-call', async () => {
    mockStagedFile('/client/note.txt', 'note.txt', 'bm90ZQ==')
    let statusCalls = 0
    runtimeEnvironmentCall.mockImplementation(async (args: RuntimeCallArgs) => {
      if (args.expectedEnvironmentPairingRevision !== CAPTURED_REVISION) {
        throw new Error('replacement HUB received an import RPC')
      }
      if (args.method === 'status.get') {
        statusCalls += 1
        if (statusCalls === 3) {
          setEnvironmentRevision(REPLACEMENT_REVISION)
        }
        return runtimeStatusResponse()
      }
      if (args.method === 'files.stat') {
        return missingRuntimePathResponse()
      }
      if (args.method === 'files.commitUpload') {
        return repairedRuntimeResponse(args.method)
      }
      return successfulRuntimeResponse(args.method)
    })

    await expect(
      importExternalPathsToRuntime(hubLocalContext, ['/client/note.txt'], '/hub/repo')
    ).resolves.toMatchObject({
      results: [{ status: 'failed', reason: 'Runtime pairing changed; retry the import.' }]
    })

    const methods = runtimeEnvironmentCall.mock.calls.map(([args]) => args.method)
    expect(methods).toContain('files.commitUpload')
    expect(methods).not.toContain('files.delete')
    expectEveryRuntimeCallBoundToCapturedRevision()
  })

})
