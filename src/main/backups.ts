import { lstat, rename, rm } from 'node:fs/promises'
import type { JournalView, RecoveryResult, TargetValues } from '@shared/write'
import type { ExifTool } from 'exiftool-vendored'
import { runRaw } from './exiftool-raw'
import {
  identityOf,
  type Journal,
  type Journals,
  type JournalTarget,
  sameIdentity,
  sidecarTemp,
} from './journal'
import { normPath, readAffected, restoreArgs, restored } from './tags'

/** ExifTool's backup of a target: `<target>_original`, only ever for journaled targets. */
export const backupOf = (target: JournalTarget): string => `${target.path}_original`

async function regularFile(path: string): Promise<{ size: number } | null> {
  try {
    const s = await lstat(path)
    return s.isFile() ? { size: s.size } : null
  } catch {
    return null
  }
}

export const hasBackup = async (target: JournalTarget): Promise<boolean> =>
  (await regularFile(backupOf(target))) !== null

/** The managed backups of one write: its targets' `_original` files, no symlinks, no globbing. */
export async function listBackups(
  journal: Journal,
): Promise<{ target: JournalTarget; path: string; size: number }[]> {
  const out: { target: JournalTarget; path: string; size: number }[] = []
  for (const target of journal.targets) {
    const file = await regularFile(backupOf(target))
    if (file) out.push({ target, path: backupOf(target), size: file.size })
  }
  return out
}

export async function journalView(journal: Journal): Promise<JournalView> {
  const backups = await listBackups(journal)
  let missing = 0
  for (const t of journal.targets) if (t.existed && !(await regularFile(t.path))) missing += 1
  return {
    writeId: journal.id,
    createdAt: journal.createdAt,
    interrupted: journal.state === 'pending',
    targets: journal.targets.length,
    restorable: journal.targets.filter((t) => t.values !== null).length,
    backups: { count: backups.length, bytes: backups.reduce((n, b) => n + b.size, 0) },
    missing,
  }
}

export class NeedsConfirmation extends Error {
  constructor() {
    super('This write was interrupted. Confirm that later changes to its files may be overwritten.')
  }
}

/**
 * The one conflict check for every restore: a finished write's target must still be exactly
 * what the write (or the last restore) left. An interrupted write recorded no such identity,
 * so it needs the user's confirmation instead.
 */
async function conflict(
  journal: Journal,
  target: JournalTarget,
  confirmInterrupted: boolean,
): Promise<string | null> {
  if (journal.state === 'pending') {
    if (!confirmInterrupted) throw new NeedsConfirmation()
    return null
  }
  const now = await identityOf(target.path)
  if (now === null) return target.existed || target.after ? 'missing' : null
  return sameIdentity(now, target.after) ? null : 'changed since write'
}

/**
 * Whether the file at a sidecar target's path is the one this write created. A finished write
 * kept only sidecars it put in place, and `conflict` matched them against `after`; an
 * interrupted one owns a sidecar once it recorded linking it, or while it is still unchanged.
 */
async function ours(journal: Journal, target: JournalTarget): Promise<boolean> {
  if (!target.created) return false
  if (journal.state === 'done' || target.owned) return true
  return sameIdentity(await identityOf(target.path), target.created)
}

/**
 * Deletes a sidecar the write created (with the `.xmp_original` holding the geotag stub), if it
 * is ours, and any temp an interrupted write left.
 */
async function removeCreated(journal: Journal, target: JournalTarget): Promise<void> {
  await rm(sidecarTemp(target.path, journal.id), { force: true })
  if (!(await ours(journal, target))) return
  await rm(target.path, { force: true })
  if (await regularFile(backupOf(target))) await rm(backupOf(target), { force: true })
}

export class Recovery {
  constructor(
    private readonly et: ExifTool,
    private readonly journals: Journals,
  ) {}

  async list(): Promise<JournalView[]> {
    const journals = await this.journals.list(hasBackup)
    return Promise.all(journals.map(journalView))
  }

  private async load(writeId: string): Promise<Journal> {
    const journal = await this.journals.get(writeId)
    if (!journal) throw new Error('This write is no longer recorded')
    return journal
  }

  /** The journaled values next to what each target holds now (for an interrupted write). */
  async inspect(writeId: string): Promise<TargetValues[]> {
    const journal = await this.load(writeId)
    const now = await readAffected(
      this.et,
      journal.targets.map((t) => t.path),
    )
    return journal.targets.map((t) => ({
      name: t.name,
      kind: t.kind,
      before: t.values,
      now: now.get(normPath(t.path)) ?? null,
    }))
  }

  /** Rewrites the journaled pre-write values (or deletes a created sidecar). */
  async restoreValues(writeId: string, confirmInterrupted: boolean): Promise<RecoveryResult> {
    const journal = await this.load(writeId)
    const result: RecoveryResult = { done: 0, skipped: [] }
    for (const target of journal.targets) {
      if (target.values === null) continue
      const reason = await conflict(journal, target, confirmInterrupted)
      if (reason) {
        result.skipped.push({ name: target.name, reason })
        continue
      }
      if (!target.existed) {
        await removeCreated(journal, target)
        target.after = null
      } else {
        try {
          await runRaw(this.et, [...restoreArgs(target.values), target.path])
        } catch (e) {
          result.skipped.push({ name: target.name, reason: (e as Error).message })
          continue
        }
        // The journaled values are only forgotten once the file is seen holding them again.
        const now = (await readAffected(this.et, [target.path])).get(normPath(target.path))
        if (!restored(target.values, now)) {
          result.skipped.push({ name: target.name, reason: 'the values did not read back' })
          target.after = await identityOf(target.path)
          continue
        }
        // Re-recorded so a later "Restore originals" still passes the conflict check.
        target.after = await identityOf(target.path)
      }
      target.values = null
      result.done += 1
    }
    await this.finish(journal)
    return result
  }

  /** Puts each `_original` back over its target (or deletes a created sidecar). */
  async restoreOriginals(writeId: string, confirmInterrupted: boolean): Promise<RecoveryResult> {
    const journal = await this.load(writeId)
    const result: RecoveryResult = { done: 0, skipped: [] }
    for (const { target, path } of await listBackups(journal)) {
      const reason = await conflict(journal, target, confirmInterrupted)
      if (reason) {
        result.skipped.push({ name: target.name, reason })
        continue
      }
      if (!target.existed) await removeCreated(journal, target)
      else await rename(path, target.path)
      target.values = null
      target.after = target.existed ? await identityOf(target.path) : null
      result.done += 1
    }
    await this.finish(journal)
    return result
  }

  async cleanupBackups(writeId: string): Promise<RecoveryResult> {
    const journal = await this.load(writeId)
    const backups = await listBackups(journal)
    for (const { path } of backups) await rm(path, { force: true })
    await this.finish(journal)
    return { done: backups.length, skipped: [] }
  }

  /** Forgets a write whose files were moved or deleted. */
  async dismiss(writeId: string): Promise<void> {
    await this.journals.delete((await this.load(writeId)).id)
  }

  private async finish(journal: Journal): Promise<void> {
    if (journal.state === 'pending' && journal.targets.every((t) => t.values === null))
      journal.state = 'done'
    if (await this.journals.prune(journal, hasBackup)) return
    await this.journals.save(journal)
  }
}
