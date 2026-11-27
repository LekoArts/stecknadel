import type { MetadataGroups } from '@shared/library'
import type { ExifTool } from 'exiftool-vendored'

const SKIP = new Set(['SourceFile', 'errors', 'warnings'])

function printable(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(printable).join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** All tags of a file as ExifTool prints them (`-G1 -a`), grouped by family-1 group. */
export async function readMetadata(et: ExifTool, file: string): Promise<MetadataGroups> {
  const raw: Record<string, unknown> = await et.readRaw(file, { readArgs: ['-G1', '-a'] })
  const groups: MetadataGroups = {}
  for (const [key, value] of Object.entries(raw)) {
    if (SKIP.has(key)) continue
    const colon = key.indexOf(':')
    const group = colon > 0 ? key.slice(0, colon) : 'Other'
    const tag = colon > 0 ? key.slice(colon + 1) : key
    groups[group] ??= {}
    groups[group][tag] = printable(value)
  }
  return groups
}
