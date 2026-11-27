import type { Dirent } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import { PHOTO_FORMATS, type PhotoExtension, type PhotoFormat, RAW_FORMATS } from '@shared/library'

export interface ScannedPhoto {
  path: string
  name: string
  /** Directory relative to the scanned root, '' for the root itself, always `/`-separated. */
  relDir: string
  format: PhotoFormat
  /** Existing `<basename>.xmp` next to a RAW (Lightroom convention). */
  sidecarPath: string | null
  /** Another RAW in the same folder shares the basename, so a sidecar would be ambiguous. */
  sidecarCollision: boolean
}

function formatOf(name: string): PhotoFormat | null {
  const ext = extname(name).slice(1).toLowerCase()
  return Object.hasOwn(PHOTO_FORMATS, ext) ? PHOTO_FORMATS[ext as PhotoExtension] : null
}

const isBackupOrTemp = (name: string): boolean =>
  name.endsWith('_original') || name.includes('_exiftool_tmp')

const stem = (name: string): string => basename(name, extname(name)).toLowerCase()

async function kindOf(dir: string, entry: Dirent): Promise<'dir' | 'file' | null> {
  if (entry.isDirectory()) return 'dir'
  if (entry.isFile()) return 'file'
  if (entry.isSymbolicLink()) {
    try {
      const target = await stat(join(dir, entry.name))
      return target.isDirectory() ? 'dir' : target.isFile() ? 'file' : null
    } catch {
      return null // dangling link
    }
  }
  return null
}

/**
 * Recursively lists the supported photos below `root`. Hidden entries, ExifTool `_original`
 * backups and `_exiftool_tmp` leftovers are skipped. Symlinked folders are followed once each
 * (by real path), so link loops terminate.
 */
export async function scanFolder(
  root: string,
  onProgress?: (found: number) => void,
): Promise<ScannedPhoto[]> {
  const photos: ScannedPhoto[] = []
  const visited = new Set<string>()
  const queue: string[] = [root]

  while (queue.length > 0) {
    const dir = queue.shift() as string
    let real: string
    try {
      real = await realpath(dir)
    } catch {
      continue
    }
    if (visited.has(real)) continue
    visited.add(real)

    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue // unreadable folder
    }

    const relDir = relative(root, dir).split(/[\\/]/).filter(Boolean).join('/')
    const sidecars = new Map<string, string>()
    const here: ScannedPhoto[] = []

    for (const entry of entries) {
      if (entry.name.startsWith('.') || isBackupOrTemp(entry.name)) continue
      const kind = await kindOf(dir, entry)
      if (kind === 'dir') {
        queue.push(join(dir, entry.name))
        continue
      }
      if (kind !== 'file') continue
      if (extname(entry.name).toLowerCase() === '.xmp') {
        sidecars.set(stem(entry.name), join(dir, entry.name))
        continue
      }
      const format = formatOf(entry.name)
      if (!format) continue
      here.push({
        path: join(dir, entry.name),
        name: entry.name,
        relDir,
        format,
        sidecarPath: null,
        sidecarCollision: false,
      })
    }

    const rawsByStem = new Map<string, ScannedPhoto[]>()
    for (const photo of here) {
      if (!RAW_FORMATS.has(photo.format)) continue
      const key = stem(photo.name)
      rawsByStem.set(key, [...(rawsByStem.get(key) ?? []), photo])
    }
    for (const [key, raws] of rawsByStem) {
      if (raws.length > 1) {
        for (const raw of raws) raw.sidecarCollision = true
      } else {
        raws[0].sidecarPath = sidecars.get(key) ?? null
      }
    }

    photos.push(...here)
    onProgress?.(photos.length)
  }

  return photos.sort((a, b) => a.path.localeCompare(b.path))
}
