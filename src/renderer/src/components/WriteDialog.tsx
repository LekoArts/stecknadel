import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { ipcErrorMessage } from '@renderer/lib/ipc-error'
import { STATUS_COLORS } from '@renderer/lib/status'
import { cn } from '@renderer/lib/utils'
import { type MatchKind, PLACED_KINDS, STATUS_LABELS } from '@shared/match/status'
import type { PreviewSnapshot } from '@shared/preview'
import type { WritingSettings } from '@shared/settings'
import type { WriteOutcome, WriteProgress, WriteReport, WriteResult } from '@shared/write'
import { LoaderCircle, MapPinCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

interface WriteDialogProps {
  snapshot: PreviewSnapshot | null
  /** A preview run is pending: the snapshot is about to change. */
  previewRunning: boolean
  writing: WritingSettings
  onWritten: (result: Extract<WriteResult, { kind: 'done' }>) => void
}

type Stage =
  | { kind: 'confirm'; stale: string | null }
  | { kind: 'writing'; progress: WriteProgress | null }
  | { kind: 'report'; report: WriteReport }
  | { kind: 'error'; message: string }

const OUTCOMES: WriteOutcome[] = ['written', 'failed', 'unmatched', 'skipped']
const OUTCOME_LABEL: Record<WriteOutcome, string> = {
  written: 'Written',
  skipped: 'Skipped',
  unmatched: 'Not placed',
  failed: 'Failed',
}
const PHASE_LABEL: Record<WriteProgress['phase'], string> = {
  checking: 'Checking files',
  writing: 'Writing',
  verifying: 'Checking what was written',
}

function optionsSummary(w: WritingSettings): string[] {
  return [
    w.overwriteGps ? 'Replaces GPS positions photos already have' : 'Keeps existing GPS positions',
    w.writeOffsetTime
      ? 'Adds the time zone offset where missing'
      : 'Leaves time zone offsets alone',
    w.rawTarget === 'sidecar' ? 'RAW files: into an .xmp sidecar' : 'RAW files: into the file',
    w.backups ? 'Keeps a copy of each original file' : 'No copies of the original files',
  ]
}

/** The Write button, its confirmation, the progress and the result report. */
export function WriteDialog({
  snapshot,
  previewRunning,
  writing,
  onWritten,
}: WriteDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>({ kind: 'confirm', stale: null })
  const [filter, setFilter] = useState<WriteOutcome | null>(null)

  const counts = useMemo(() => {
    const out = new Map<MatchKind, number>()
    for (const r of snapshot?.results ?? [])
      out.set(r.status.kind, (out.get(r.status.kind) ?? 0) + 1)
    return out
  }, [snapshot])
  const targets = [...PLACED_KINDS].reduce((n, k) => n + (counts.get(k) ?? 0), 0)

  useEffect(
    () =>
      window.stecknadel.on('writeProgress', (progress) =>
        setStage((s) => (s.kind === 'writing' ? { kind: 'writing', progress } : s)),
      ),
    [],
  )

  const start = async (): Promise<void> => {
    if (!snapshot) return
    setStage({ kind: 'writing', progress: null })
    try {
      const result = await window.stecknadel.writePhotos({
        generation: snapshot.generation,
        writing,
        ids: snapshot.results.map((r) => r.id),
      })
      if (result.kind === 'stale') {
        setStage({ kind: 'confirm', stale: result.reason })
        return
      }
      setFilter(null)
      setStage({ kind: 'report', report: result.report })
      onWritten(result)
    } catch (error) {
      setStage({ kind: 'error', message: ipcErrorMessage(error) })
    }
  }

  const exportReport = async (): Promise<void> => {
    try {
      await window.stecknadel.exportReport()
    } catch (error) {
      setStage({ kind: 'error', message: ipcErrorMessage(error) })
    }
  }

  const busy = stage.kind === 'writing'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        setOpen(next)
        if (next) setStage({ kind: 'confirm', stale: null })
      }}
    >
      <Button
        size="sm"
        // As tall as the panel toggle bar beside it (32 px buttons + padding + border).
        className="pointer-events-auto h-[38px] px-4 shadow-sm has-[>svg]:px-3.5"
        disabled={!snapshot || previewRunning || targets === 0}
        title={targets === 0 && snapshot ? 'No photo has a position to write' : 'Write positions'}
        onClick={() => {
          setStage({ kind: 'confirm', stale: null })
          setOpen(true)
        }}
      >
        <MapPinCheck />
        Write
      </Button>
      <DialogContent
        className={cn(stage.kind === 'report' && 'sm:max-w-2xl')}
        showCloseButton={!busy}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        onInteractOutside={(e) => busy && e.preventDefault()}
      >
        {stage.kind === 'confirm' && (
          <>
            <DialogHeader>
              <DialogTitle>
                Write {targets} {targets === 1 ? 'position' : 'positions'}
              </DialogTitle>
              <DialogDescription>The other photos stay as they are.</DialogDescription>
            </DialogHeader>
            <ul className="grid gap-1 text-sm" data-testid="write-counts">
              {[...counts].map(([kind, n]) => (
                <li key={kind} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: STATUS_COLORS[kind] }}
                  />
                  <span className="flex-1">{STATUS_LABELS[kind]}</span>
                  <span className="text-muted-foreground tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
            <ul className="grid gap-0.5 text-muted-foreground text-sm">
              {optionsSummary(writing).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {stage.stale && (
              <p role="alert" className="text-destructive text-sm">
                {stage.stale} Check the map, then write again.
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void start()} disabled={previewRunning || targets === 0}>
                Write
              </Button>
            </DialogFooter>
          </>
        )}

        {stage.kind === 'writing' && (
          <>
            <DialogHeader>
              <DialogTitle>Writing positions</DialogTitle>
              <DialogDescription>Don't move or edit the photos until it's done.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 text-sm" role="status">
              <LoaderCircle className="size-4 animate-spin" />
              {stage.progress
                ? `${PHASE_LABEL[stage.progress.phase]}: ${stage.progress.done} of ${stage.progress.total}`
                : 'Checking the preview'}
            </div>
          </>
        )}

        {stage.kind === 'report' && (
          <WriteReportView
            report={stage.report}
            filter={filter}
            onFilter={setFilter}
            onExport={() => void exportReport()}
            onClose={() => setOpen(false)}
          />
        )}

        {stage.kind === 'error' && (
          <>
            <DialogHeader>
              <DialogTitle>Writing stopped</DialogTitle>
            </DialogHeader>
            <p role="alert" className="text-destructive text-sm">
              {stage.message}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function WriteReportView({
  report,
  filter,
  onFilter,
  onExport,
  onClose,
}: {
  report: WriteReport
  filter: WriteOutcome | null
  onFilter: (f: WriteOutcome | null) => void
  onExport: () => void
  onClose: () => void
}): React.JSX.Element {
  const rows = filter ? report.rows.filter((r) => r.outcome === filter) : report.rows
  const failed = report.counts.failed
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {failed > 0
            ? `${failed} ${failed === 1 ? 'file' : 'files'} failed`
            : `Wrote ${report.counts.written} ${report.counts.written === 1 ? 'position' : 'positions'}`}
        </DialogTitle>
        <DialogDescription>
          {failed > 0
            ? 'Their previous values can be restored from Recent writes.'
            : 'Every written file was read back and matches the map.'}
        </DialogDescription>
      </DialogHeader>
      <fieldset aria-label="Show" className="flex flex-wrap gap-1" data-testid="report-filters">
        <FilterChip active={filter === null} onClick={() => onFilter(null)}>
          All {report.rows.length}
        </FilterChip>
        {OUTCOMES.filter((o) => report.counts[o] > 0).map((o) => (
          <FilterChip key={o} active={filter === o} onClick={() => onFilter(o)} outcome={o}>
            {OUTCOME_LABEL[o]} {report.counts[o]}
          </FilterChip>
        ))}
      </fieldset>
      <div className="max-h-72 overflow-y-auto rounded-md border" data-testid="write-report">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-outcome={r.outcome} className="border-b last:border-b-0">
                <td className="max-w-56 truncate px-3 py-1.5" title={r.name}>
                  {r.name}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span className={cn(r.outcome === 'failed' && 'text-destructive')}>
                    {OUTCOME_LABEL[r.outcome]}
                  </span>
                  {r.target === 'sidecar' && (
                    <span className="text-muted-foreground"> to .xmp</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {r.reason ?? r.warnings.join('; ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onExport}>
          Export report as CSV
        </Button>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  )
}

function FilterChip({
  active,
  onClick,
  outcome,
  children,
}: {
  active: boolean
  onClick: () => void
  outcome?: WriteOutcome
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      size="sm"
      variant={active ? 'secondary' : 'ghost'}
      aria-pressed={active}
      data-outcome={outcome}
      className="h-7 tabular-nums"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
