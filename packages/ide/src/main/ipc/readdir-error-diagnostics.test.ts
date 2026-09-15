import { describe, expect, it } from 'vitest'
import { buildReadDirErrorBreadcrumb, describeReadDirPathShape } from './readdir-error-diagnostics'

describe('describeReadDirPathShape', () => {
  it('classifies a WSL UNC path without leaking it', () => {
    const shape = describeReadDirPathShape('\\\\wsl.localhost\\Ubuntu\\home\\u\\repo')
    expect(shape).toEqual({ isUNC: true, isWsl: true })
  })

  it('classifies the legacy \\\\wsl$ root as WSL', () => {
    expect(describeReadDirPathShape('\\\\wsl$\\Ubuntu\\home').isWsl).toBe(true)
  })

  it('classifies a plain network UNC share as UNC but not WSL', () => {
    const shape = describeReadDirPathShape('\\\\fileserver\\share\\dir')
    expect(shape).toMatchObject({ isUNC: true, isWsl: false })
    expect(shape.driveLetter).toBeUndefined()
  })

  it('extracts an uppercased drive letter for mapped drives', () => {
    expect(describeReadDirPathShape('z:\\projects\\repo')).toEqual({
      isUNC: false,
      isWsl: false,
      driveLetter: 'Z'
    })
  })

  it('never includes the raw path in the shape', () => {
    const shape = describeReadDirPathShape('\\\\wsl.localhost\\Ubuntu\\secret\\path')
    expect(JSON.stringify(shape)).not.toContain('secret')
  })
})

describe('buildReadDirErrorBreadcrumb', () => {
  it('captures throw site, error code/name, and path shape', () => {
    const breadcrumb = buildReadDirErrorBreadcrumb({
      dirPath: '\\\\wsl.localhost\\Ubuntu\\home\\u\\repo',
      throwSite: 'readdir',
      error: Object.assign(new Error('EIO: i/o error'), { code: 'EIO' })
    })
    expect(breadcrumb).toEqual({
      throwSite: 'readdir',
      errorName: 'Error',
      errorCode: 'EIO',
      isUNC: true,
      isWsl: true
    })
  })

  it('omits errorCode when the error has none', () => {
    const breadcrumb = buildReadDirErrorBreadcrumb({
      dirPath: '/home/me/repo',
      throwSite: 'authorize',
      error: new Error('Path not authorized.')
    })
    expect(breadcrumb).toMatchObject({ throwSite: 'authorize', errorName: 'Error' })
    expect(breadcrumb.errorCode).toBeUndefined()
  })
})
