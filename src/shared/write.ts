import { z } from 'zod'
import type { LibrarySnapshot } from './library'
import type { MatchKind } from './match/status'
import type { Position } from './preview'
import { writingSchema } from './settings'

export const writeInputSchema = z.strictObject({
  /** The preview generation the user confirmed. */
  generation: z.number().int().positive(),
  /** The writing options the confirmation showed. */
  writing: writingSchema,
})

export type WriteOutcome = 'written' | 'skipped' | 'unmatched' | 'failed'

export interface ReportRow {
  id: string
  /** `relDir/name`. */
  name: string
  outcome: WriteOutcome
  status: MatchKind
  /** Why it was skipped, unmatched or failed; null when written. */
  reason: string | null
  warnings: string[]
  /** Where the coordinates went: the photo or its `.xmp` sidecar. */
  target: 'photo' | 'sidecar' | null
  /** What the file says after the write (read back), for written and mismatched files. */
  written: Position | null
}

export interface WriteReport {
  writeId: string | null
  rows: ReportRow[]
  counts: Record<WriteOutcome, number>
  durationMs: number
}

export type WriteResult =
  | { kind: 'stale'; reason: string }
  /** `library`: the folder read again, so the app sees what the files now say. */
  | { kind: 'done'; report: WriteReport; library?: LibrarySnapshot | null }

export interface WriteProgress {
  phase: 'checking' | 'writing' | 'verifying'
  done: number
  total: number
}

export const writeRefSchema = z.strictObject({ writeId: z.string().regex(/^[0-9a-f-]{36}$/) })
export const restoreInputSchema = z.strictObject({
  writeId: z.string().regex(/^[0-9a-f-]{36}$/),
  /** Needed for an interrupted write: later edits to its files get overwritten. */
  confirmInterrupted: z.boolean(),
})

/** One write as the recovery menu shows it. */
export interface JournalView {
  writeId: string
  createdAt: number
  /** The app stopped during the write: no post-write identity was recorded. */
  interrupted: boolean
  targets: number
  /** Targets whose previous values can still be restored. */
  restorable: number
  backups: { count: number; bytes: number }
  /** Targets that no longer exist (moved or deleted). */
  missing: number
}

export interface TargetValues {
  name: string
  kind: 'photo' | 'sidecar'
  before: Record<string, string | number> | null
  now: Record<string, string | number> | null
}

export interface RecoveryResult {
  done: number
  /** Targets left alone, with why (`changed since write`, `missing`). */
  skipped: { name: string; reason: string }[]
}

const csvField = (value: string): string => {
  // A file name like `=HYPERLINK(…)` must not turn into a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

const fmt = (p: Position | null): string[] =>
  p ? [String(p.lat), String(p.lon), p.ele === null ? '' : String(p.ele)] : ['', '', '']

/** The report as CSV, one row per photo. */
export function reportCsv(report: WriteReport): string {
  const head = [
    'File',
    'Result',
    'Status',
    'Reason',
    'Warnings',
    'Target',
    'Latitude',
    'Longitude',
    'Altitude',
  ]
  const lines = report.rows.map((r) =>
    [
      r.name,
      r.outcome,
      r.status,
      r.reason ?? '',
      r.warnings.join('; '),
      r.target ?? '',
      ...fmt(r.written),
    ]
      .map(csvField)
      .join(','),
  )
  return `${[head.join(','), ...lines].join('\n')}\n`
}
