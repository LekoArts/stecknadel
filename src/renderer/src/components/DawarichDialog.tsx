import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { ipcErrorMessage } from '@renderer/lib/ipc-error'
import type { DawarichState } from '@shared/ipc'
import type { FetchRange } from '@shared/track/range'
import type { TrackSummary } from '@shared/track/types'
import { useEffect, useId, useState } from 'react'

interface DawarichDialogProps {
  state: DawarichState
  defaultRange: FetchRange | null
  /** Opens the dialog with this range (the outside-range banner's "Fetch again"). */
  openRequest: { range: FetchRange } | null
  onState: (state: DawarichState) => void
  onTrack: (track: TrackSummary) => void
}

type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'tested'; version: string | null }
  | { kind: 'fetching'; page: number; totalPages: number }
  | { kind: 'error'; message: string }

/** `2026-11-02T00:00:00Z` ↔ the `datetime-local` value `2026-11-02T00:00`, both UTC. */
const toInput = (iso: string): string => iso.slice(0, 16)
const fromInput = (value: string): string => `${value}:00Z`

function lastWeek(): FetchRange {
  const end = new Date()
  end.setUTCHours(24, 0, 0, 0)
  const start = new Date(end.getTime() - 8 * 86_400_000)
  return { start: start.toISOString(), end: end.toISOString() }
}

export function DawarichDialog({
  state,
  defaultRange,
  openRequest,
  onState,
  onTrack,
}: DawarichDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(state.url ?? '')
  const [key, setKey] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const ids = useId()

  useEffect(
    () =>
      window.stecknadel.on('trackProgress', (p) =>
        setStatus((s) => (s.kind === 'fetching' ? { kind: 'fetching', ...p } : s)),
      ),
    [],
  )

  const onOpenChange = (next: boolean, range: FetchRange = defaultRange ?? lastWeek()): void => {
    if (status.kind === 'fetching') return
    if (next) {
      setUrl(state.url ?? '')
      setKey('')
      setStart(toInput(range.start))
      setEnd(toInput(range.end))
      setStatus({ kind: 'idle' })
    }
    setOpen(next)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: react to new requests only
  useEffect(() => {
    if (openRequest) onOpenChange(true, openRequest.range)
  }, [openRequest])

  const typedKey = key.trim() || undefined
  const busy = status.kind === 'testing' || status.kind === 'fetching'
  const canConnect = url.trim() !== '' && (typedKey !== undefined || state.hasKey)
  const rangeValid = start !== '' && end !== '' && start < end

  const test = async (): Promise<void> => {
    setStatus({ kind: 'testing' })
    try {
      const { version } = await window.stecknadel.testDawarich({ url: url.trim(), key: typedKey })
      setStatus({ kind: 'tested', version })
    } catch (e) {
      setStatus({ kind: 'error', message: ipcErrorMessage(e) })
    }
  }

  const fetchTrack = async (): Promise<void> => {
    setStatus({ kind: 'fetching', page: 0, totalPages: 0 })
    try {
      onState(await window.stecknadel.saveDawarichSettings({ url: url.trim(), key: typedKey }))
      setKey('')
      const track = await window.stecknadel.fetchDawarich({
        start: fromInput(start),
        end: fromInput(end),
      })
      onTrack(track)
      setStatus({ kind: 'idle' })
      setOpen(false)
    } catch (e) {
      setStatus({ kind: 'error', message: ipcErrorMessage(e) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Dawarich…
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void fetchTrack()
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>Fetch track from Dawarich</DialogTitle>
            <DialogDescription className="sr-only">
              Server address, API key and the time range to fetch
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor={`${ids}-url`}>Server address</Label>
            <Input
              id={`${ids}-url`}
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              placeholder="https://dawarich.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${ids}-key`}>API key</Label>
            <Input
              id={`${ids}-key`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={state.hasKey ? 'Saved — type to replace' : ''}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={busy || !state.secureStorage}
              required={!state.hasKey}
            />
            {!state.secureStorage && (
              <p className="text-destructive text-xs">
                This computer has no secure key storage, so the API key can’t be saved.
              </p>
            )}
          </div>

          <fieldset className="grid grid-cols-2 gap-2" disabled={busy}>
            <legend className="mb-2 font-medium text-sm">Time range (UTC)</legend>
            <Label htmlFor={`${ids}-start`} className="sr-only">
              From (UTC)
            </Label>
            <Input
              id={`${ids}-start`}
              type="datetime-local"
              value={start}
              max={end || undefined}
              onChange={(e) => setStart(e.target.value)}
              required
            />
            <Label htmlFor={`${ids}-end`} className="sr-only">
              To (UTC)
            </Label>
            <Input
              id={`${ids}-end`}
              type="datetime-local"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </fieldset>

          <p
            data-testid="dawarich-status"
            role={status.kind === 'error' ? 'alert' : 'status'}
            className={
              status.kind === 'error'
                ? 'min-h-5 text-destructive text-xs'
                : 'min-h-5 text-muted-foreground text-xs tabular-nums'
            }
          >
            {status.kind === 'testing' && 'Connecting…'}
            {status.kind === 'tested' &&
              `Connected${status.version ? ` · Dawarich ${status.version}` : ''}`}
            {status.kind === 'fetching' &&
              (status.totalPages > 0
                ? `Fetching page ${status.page} of ${status.totalPages}`
                : 'Fetching…')}
            {status.kind === 'error' && status.message}
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void test()}
              disabled={busy || !canConnect}
            >
              Test connection
            </Button>
            <Button type="submit" disabled={busy || !canConnect || !rangeValid}>
              Fetch track
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
