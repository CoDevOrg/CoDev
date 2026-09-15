import { describe, expect, it } from 'vitest'
import { encodePowerShellCommand } from './powershell-osc133-bootstrap'

describe('PowerShell OSC 133 bootstrap', () => {

  it('encodes commands as UTF-16LE base64 for PowerShell -EncodedCommand', () => {
    expect(encodePowerShellCommand('Write-Output ok')).toBe(
      Buffer.from('Write-Output ok', 'utf16le').toString('base64')
    )
  })
})
