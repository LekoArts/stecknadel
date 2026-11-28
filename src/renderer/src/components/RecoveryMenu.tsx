import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Label } from '@renderer/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { ipcErrorMessage } from '@renderer/lib/ipc-error'
import type { JournalView, RecoveryResult, TargetValues } from '@shared/write'
import { History, LoaderCircle } from 'lucide-react'
import { useState } from 'react'

type Action = 'restoreValues' | 'restoreOriginals' | 'cleanupBackups'

const ACTION: Record<Action, { title: string; button: string; done: string }> = {
  restoreValues: {
    title: 'Restore previous values',
    button: 'Restore values',
    done: 'Restored',
  },
  restoreOriginals: {
    title: 'Restore original files',
    button: 'Restore originals',
    done: 'Restored',
  },
  cleanupBackups: {
    title: 'Delete the original copies',
    button: 'Delete copies',
    done: 'Deleted',
  },
}

const bytes = (n: number): string =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`

const when = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function actionText(action: Action, w: JournalView): string {
  switch (action) {
    case 'restoreValues':
      return `Puts back the GPS and time zone values ${w.restorable} ${w.restorable === 1 ? 'file' : 'files'} had before this write, and removes sidecars it created. Files edited since are left alone.`
    case 'restoreOriginals':
      return `Replaces ${w.backups.count} edited ${w.backups.count === 1 ? 'file' : 'files'} with the copy kept before writing. Files edited since are left alone.`
    case 'cleanupBackups':
      return `Deletes ${w.backups.count} ${w.backups.count === 1 ? 'copy' : 'copies'} (${bytes(w.backups.bytes)}). The written files stay as they are.`
  }
}

interface RecoveryMenuProps {
  writes: JournalView[]
  /** Something changed on disk: reload the list and the folder. */
  onChanged: () => void
}

/** Recent writes, with restore and cleanup. Only shown when there is something to act on. */
export function RecoveryMenu({ writes, onChanged }: RecoveryMenuProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<{ action: Action; write: JournalView } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RecoveryResult | null>(null)
  const [changes, setChanges] = useState<TargetValues[] | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  // The dialog outlives the last write it restored: it still has the result to show.
  if (writes.length === 0 && pending === null) return null

  const ask = (action: Action, write: JournalView): void => {
    setOpen(false)
    setPending({ action, write })
    setError(null)
    setResult(null)
    setConfirmed(false)
    setChanges(null)
    if (write.interrupted && action !== 'cleanupBackups') {
      window.stecknadel
        .inspectWrite({ writeId: write.writeId })
        .then(setChanges, (e) => setError(ipcErrorMessage(e)))
    }
  }

  const run = async (): Promise<void> => {
    if (!pending) return
    const { action, write } = pending
    setBusy(true)
    setError(null)
    try {
      const ref = { writeId: write.writeId }
      const r =
        action === 'cleanupBackups'
          ? await window.stecknadel.cleanupBackups(ref)
          : await window.stecknadel[action]({ ...ref, confirmInterrupted: confirmed })
      setResult(r)
      onChanged()
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const dismiss = async (write: JournalView): Promise<void> => {
    await window.stecknadel.dismissWrite({ writeId: write.writeId })
    onChanged()
  }

  const needsConfirm = pending?.write.interrupted && pending.action !== 'cleanupBackups'

  return (
    <>
      {writes.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Recent writes"
              title="Recent writes"
              className="pointer-events-auto"
            >
              <History />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0" aria-label="Recent writes">
            <ul className="max-h-96 divide-y overflow-y-auto">
              {writes.map((w) => (
                <li key={w.writeId} className="grid gap-1.5 p-3 text-sm" data-testid="recent-write">
                  <div className="flex items-baseline gap-2">
                    <span className="flex-1 font-medium">{when(w.createdAt)}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {w.targets} {w.targets === 1 ? 'file' : 'files'}
                    </span>
                  </div>
                  {w.interrupted && (
                    <p className="text-amber-700 dark:text-amber-400">Stopped before it finished</p>
                  )}
                  {w.missing > 0 && (
                    <p className="text-muted-foreground">
                      {w.missing} {w.missing === 1 ? 'file was' : 'files were'} moved or deleted
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {w.restorable > 0 && (
                      <Button size="sm" variant="outline" onClick={() => ask('restoreValues', w)}>
                        Restore values
                      </Button>
                    )}
                    {w.backups.count > 0 && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => ask('restoreOriginals', w)}
                        >
                          Restore originals
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => ask('cleanupBackups', w)}>
                          Delete copies
                        </Button>
                      </>
                    )}
                    {((w.restorable === 0 && w.backups.count === 0) || w.missing > 0) && (
                      <Button size="sm" variant="ghost" onClick={() => void dismiss(w)}>
                        Forget
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}

      <Dialog open={pending !== null} onOpenChange={(o) => !busy && !o && setPending(null)}>
        {pending && (
          <DialogContent showCloseButton={!busy}>
            <DialogHeader>
              <DialogTitle>{ACTION[pending.action].title}</DialogTitle>
              <DialogDescription>{actionText(pending.action, pending.write)}</DialogDescription>
            </DialogHeader>
            {needsConfirm && !result && (
              <div className="grid gap-2 text-sm">
                <p>
                  This write stopped before it finished, so the app can't tell whether a file was
                  edited afterwards. Restoring overwrites such edits.
                </p>
                {changes && changes.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto rounded-md border text-xs">
                    {changes.map((c) => (
                      <li
                        key={`${c.kind}:${c.name}`}
                        className="border-b px-2 py-1 last:border-b-0"
                      >
                        {c.name}
                        {c.kind === 'sidecar' ? ' (sidecar)' : ''}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="restore-anyway"
                    checked={confirmed}
                    onCheckedChange={(next) => setConfirmed(next === true)}
                  />
                  <Label htmlFor="restore-anyway" className="font-normal">
                    Restore anyway
                  </Label>
                </div>
              </div>
            )}
            {result && (
              <div className="grid gap-1 text-sm" role="status">
                <p>
                  {ACTION[pending.action].done} {result.done} {result.done === 1 ? 'file' : 'files'}
                  .
                </p>
                {result.skipped.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto text-muted-foreground">
                    {result.skipped.map((s) => (
                      <li key={s.name}>
                        {s.name}: {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <DialogFooter>
              {result ? (
                <Button onClick={() => setPending(null)}>Done</Button>
              ) : (
                <>
                  <Button variant="outline" disabled={busy} onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant={pending.action === 'cleanupBackups' ? 'destructive' : 'default'}
                    disabled={busy || (needsConfirm && !confirmed)}
                    onClick={() => void run()}
                  >
                    {busy && <LoaderCircle className="animate-spin" />}
                    {ACTION[pending.action].button}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
