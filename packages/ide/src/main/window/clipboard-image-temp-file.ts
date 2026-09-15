import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { app } from 'electron'
import { assertClipboardImageByteLengthWithinLimit } from '../../shared/clipboard-image'

export type SaveClipboardImageAsTempFileArgs = {
  /** Legacy remote-target id; ignored (pastes always land on this host). */
  connectionId?: string | null
  runtimeEnvironmentId?: string | null
}

export async function saveClipboardImageBufferAsTempFile(
  buffer: Buffer,
  _args?: SaveClipboardImageAsTempFileArgs
): Promise<string> {
  assertClipboardImageByteLengthWithinLimit(buffer.byteLength)

  const fileName = `orca-paste-${Date.now()}-${randomUUID()}.png`
  const tempPath = path.join(app.getPath('temp'), fileName)
  await fs.writeFile(tempPath, buffer)
  return tempPath
}
