import { describe, expect, it } from 'vitest'
import { mapRuntimeError } from './errors'

class LineageError extends Error {
  code = 'LINEAGE_PARENT_NOT_FOUND'
  data = {
    nextSteps: ['Run `orca worktree list`.', 'Retry with --no-parent.']
  }
}

describe('mapRuntimeError', () => {
  it.each(['terminal_tab_close_timeout', 'terminal_tab_not_found', 'terminal_tab_pinned'])(
    'preserves the durable terminal tab close failure %s',
    (code) => {
      expect(mapRuntimeError('req_1', { runtimeId: 'runtime-1' }, new Error(code))).toMatchObject({
        ok: false,
        error: { code, message: code }
      })
    }
  )

  it.each([
    'remote_update_manual_required',
    'remote_update_not_available',
    'remote_update_not_downloaded'
  ])('preserves remote updater failure %s', (code) => {
    expect(mapRuntimeError('req_1', { runtimeId: 'runtime-1' }, new Error(code))).toMatchObject({
      ok: false,
      error: { code, message: code }
    })
  })

  it.each(['remote_runtime_unavailable', 'runtime_timeout', 'invalid_runtime_response'])(
    'preserves structured remote transport failure %s',
    (code) => {
      const error = Object.assign(new Error(`Remote transport failed: ${code}`), { code })

      expect(mapRuntimeError('req_1', { runtimeId: 'runtime-1' }, error)).toMatchObject({
        ok: false,
        error: { code, message: `Remote transport failed: ${code}` }
      })
    }
  )

  it('preserves structured lineage error codes and data for CLI recovery hints', () => {
    const response = mapRuntimeError(
      'req_1',
      { runtimeId: 'runtime-1' },
      new LineageError('Parent selector was not found.')
    )

    expect(response).toEqual({
      id: 'req_1',
      ok: false,
      error: {
        code: 'LINEAGE_PARENT_NOT_FOUND',
        message: 'Parent selector was not found.',
        data: {
          nextSteps: ['Run `orca worktree list`.', 'Retry with --no-parent.']
        }
      },
      _meta: { runtimeId: 'runtime-1' }
    })
  })
})
