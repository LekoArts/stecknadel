import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

/** After this long a journal forgets the pre-write values; its backups stay discoverable. */
export const VALUES_TTL_MS = 30 * 86_400_000

const identitySchema = z.strictObject({
  size: z.number(),
  mtimeMs: z.number(),
  sha256: z.string(),
})
export type Identity = z.infer<typeof identitySchema>

/** Group-qualified tag (`GPS:GPSLatitude`, `XMP-exif:DateTimeOriginal`, …) → value as read. */
const tagValuesSchema = z.record(z.string(), z.union([z.string(), z.number()]))
export type TagValues = z.infer<typeof tagValuesSchema>

const targetSchema = z.strictObject({
  photoId: z.string(),
  /** `relDir/name` of the photo, for the report and recovery list. */
  name: z.string(),
  path: z.string(),
  kind: z.enum(['photo', 'sidecar']),
  /** False for a sidecar that didn't exist before the write. */
  existed: z.boolean(),
  /**
   * The sidecar this write is about to create, recorded before it appears at `path` (it is made
   * under a temp name and linked into place, which fails if anything is there). Only a sidecar
   * recorded here may be deleted by a restore.
   */
  created: identitySchema.nullable(),
  /**
   * The affected tags before the write (`{}` for a sidecar the write creates); null once
   * restored or expired.
   */
  values: tagValuesSchema.nullable(),
  /** The target right after the write (or after a restore); null while pending. */
  after: identitySchema.nullable(),
})
export type JournalTarget = z.infer<typeof targetSchema>

const journalSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().regex(/^[0-9a-f-]{36}$/),
  createdAt: z.number(),
  state: z.enum(['pending', 'done']),
  backups: z.boolean(),
  targets: z.array(targetSchema),
})
export type Journal = z.infer<typeof journalSchema>

/** Makes the rename itself durable. Windows can't open a directory; there the rename is enough. */
async function syncDir(dir: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(dir, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export const newJournalId = (): string => randomUUID()

export async function identityOf(path: string): Promise<Identity | null> {
  let s: Awaited<ReturnType<typeof lstat>>
  try {
    s = await lstat(path)
  } catch {
    return null
  }
  if (!s.isFile()) return null
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return { size: s.size, mtimeMs: s.mtimeMs, sha256: hash.digest('hex') }
}

export const sameIdentity = (a: Identity | null, b: Identity | null): boolean =>
  a !== null && b !== null && a.size === b.size && a.sha256 === b.sha256

/**
 * Pre-write transaction records in `userData/journal/<id>.json`. Every save is written to a temp
 * file, fsynced and renamed, so a crash leaves either the old or the new record.
 */
export class Journals {
  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private file(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  async save(journal: Journal): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tmp = `${this.file(journal.id)}.tmp`
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(JSON.stringify(journal))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, this.file(journal.id))
    await syncDir(this.dir)
  }

  async get(id: string): Promise<Journal | null> {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null
    try {
      return journalSchema.parse(JSON.parse(await readFile(this.file(id), 'utf8')))
    } catch {
      return null
    }
  }

  async delete(id: string): Promise<void> {
    await rm(this.file(id), { force: true })
  }

  /**
   * Every readable journal, newest first. Values older than the TTL are dropped here (and the
   * journal saved), and a journal left with neither values nor backups is deleted.
   */
  async list(hasBackup: (target: JournalTarget) => Promise<boolean>): Promise<Journal[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return []
    }
    const out: Journal[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const journal = await this.get(name.slice(0, -5))
      if (!journal) continue
      if (this.now() - journal.createdAt > VALUES_TTL_MS && journal.targets.some((t) => t.values)) {
        for (const t of journal.targets) t.values = null
        await this.save(journal)
      }
      if (await this.prune(journal, hasBackup)) continue
      out.push(journal)
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Deletes the journal when nothing in it can still be restored or cleaned up. */
  async prune(
    journal: Journal,
    hasBackup: (target: JournalTarget) => Promise<boolean>,
  ): Promise<boolean> {
    if (journal.targets.some((t) => t.values !== null)) return false
    for (const t of journal.targets) if (await hasBackup(t)) return false
    await this.delete(journal.id)
    return true
  }
}
