import { DawarichDialog } from '@renderer/components/DawarichDialog'
import { Button } from '@renderer/components/ui/button'
import { formatUtc } from '@renderer/lib/format'
import { ipcErrorMessage } from '@renderer/lib/ipc-error'
import type { DawarichState } from '@shared/ipc'
import type { FetchRange } from '@shared/track/range'
import type { TrackSummary } from '@shared/track/types'
import { useState } from 'react'

interface TrackPanelProps {
  track: TrackSummary | null
  dawarich: DawarichState | null
  defaultRange: FetchRange | null
  fetchRequest: { range: FetchRange } | null
  onTrack: (track: TrackSummary) => void
  onDawarich: (state: DawarichState) => void
}

export function TrackPanel({
  track,
  dawarich,
  defaultRange,
  fetchRequest,
  onTrack,
  onDawarich,
}: TrackPanelProps): React.JSX.Element {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadGpx = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const summary = await window.stecknadel.loadGpx()
      if (summary) onTrack(summary)
    } catch (e) {
      setError(`Couldn’t load the GPX file: ${ipcErrorMessage(e)}`)
    } finally {
      setLoading(false)
    }
  }

  const skipped = track ? Object.values(track.dropped).reduce((a, b) => a + b, 0) : 0

  return (
    <section aria-label="Track" className="flex flex-col gap-2 border-t px-4 py-3">
      <h2 className="font-medium">Track</h2>
      {track && (
        <dl data-testid="track-summary" className="grid gap-0.5">
          <dt className="sr-only">Source</dt>
          <dd className="truncate" title={sourceLabel(track)}>
            {sourceLabel(track)}
          </dd>
          <dt className="sr-only">Points</dt>
          <dd className="text-muted-foreground tabular-nums">
            {track.count.toLocaleString()} points
            {skipped > 0 && ` · ${skipped.toLocaleString()} skipped`}
          </dd>
          {track.first && track.last && (
            <>
              <dt className="sr-only">Time span</dt>
              <dd className="text-muted-foreground text-xs tabular-nums">
                <span className="whitespace-nowrap">{formatUtc(track.first)} –</span>{' '}
                <span className="whitespace-nowrap">{formatUtc(track.last)} UTC</span>
              </dd>
            </>
          )}
        </dl>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 *:min-w-0">
        <Button size="sm" variant="outline" onClick={() => void loadGpx()} disabled={loading}>
          Load GPX…
        </Button>
        {dawarich && (
          <DawarichDialog
            state={dawarich}
            defaultRange={defaultRange}
            openRequest={fetchRequest}
            onState={onDawarich}
            onTrack={onTrack}
          />
        )}
      </div>
    </section>
  )
}

function sourceLabel(track: TrackSummary): string {
  return track.source.kind === 'gpx' ? track.source.fileName : 'Dawarich'
}
