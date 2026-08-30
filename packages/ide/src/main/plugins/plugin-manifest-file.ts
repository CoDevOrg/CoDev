import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { preferExistingName } from '../../shared/codev-identifiers'
import {
  PLUGIN_MANIFEST_FILENAME,
  PLUGIN_MANIFEST_FILENAMES
} from '../../shared/plugins/plugin-manifest'

/** A plugin's manifest path, accepting the legacy name for older plugins. */
export function pluginManifestPath(rootDir: string): string {
  return join(
    rootDir,
    preferExistingName(PLUGIN_MANIFEST_FILENAMES, (name) => existsSync(join(rootDir, name)))
  )
}

/** A manifest is startup metadata, not an artifact payload. Bounding it keeps
 * discovery and install preview from allocating an attacker-sized JSON file. */
export const PLUGIN_MANIFEST_MAX_BYTES = 1024 * 1024

export async function readPluginManifestText(rootDir: string): Promise<string> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  const stream = createReadStream(pluginManifestPath(rootDir))
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += bytes.byteLength
    if (totalBytes > PLUGIN_MANIFEST_MAX_BYTES) {
      throw new Error(`${PLUGIN_MANIFEST_FILENAME} exceeds ${PLUGIN_MANIFEST_MAX_BYTES} bytes`)
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8')
}
