import { type ClickMode, type MapPin, MapView } from '@renderer/components/MapView'
import { Button } from '@renderer/components/ui/button'
import type { PreviewState } from '@renderer/lib/preview'
import { notPlacedIds, STATUS_COLORS, statusCounts } from '@renderer/lib/status'
import { useThumbnail } from '@renderer/lib/thumbnails'
import { formatInstant, offsetLabel } from '@renderer/lib/time'
import { cn } from '@renderer/lib/utils'
import type { LibrarySnapshot, PhotoSummary } from '@shared/library'
import { type MatchKind, type MatchStatus, STATUS_LABELS, statusDetail } from '@shared/match/status'
import type { Position, TrackGeometry } from '@shared/preview'
import type { MapSourceView } from '@shared/settings'
import { instantSeconds, secondsToInstant, wallAsUtcSeconds } from '@shared/time/exifDate'
import { findOffsetCandidates, type OffsetCandidate } from '@shared/time/offsetFinder'
import type { PhotoUtc } from '@shared/time/toUtc'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Crosshair,
  LoaderCircle,
  MapPin as Pin,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

const LIST_LIMIT = 300

interface MapPanelProps {
  mapSource: MapSourceView | null
  mapRevision: number
  library: LibrarySnapshot | null
  hasTrack: boolean
  geometry: TrackGeometry | null
  preview: PreviewState
  /** One entry per photo from the preview: the legend, list and hover cards read it. */
  statuses: Map<string, MatchStatus>
  /** Loading the track, its zones or the settings failed. */
  loadError: string | null
  /** A retry is in flight: keep the button where the user clicked it, disabled. */
  retrying: boolean
  onRetry: () => void
  utcs: Map<string, PhotoUtc>
  /** Photos of the selected camera, or null for all cameras: the legend and Not placed list count only these. */
  scope: Set<string> | null
  selectedId: string | null
  onSelect: (id: string) => void
  onApplyOffset: (photo: PhotoSummary, candidate: OffsetCandidate) => void
  onManual: (id: string, position: Position | null) => void
}

type Finder = { candidates: OffsetCandidate[] } | null

export function MapPanel({
  mapSource,
  mapRevision,
  library,
  hasTrack,
  geometry,
  preview,
  statuses,
  loadError,
  retrying,
  onRetry,
  utcs,
  scope,
  selectedId,
  onSelect,
  onApplyOffset,
  onManual,
}: MapPanelProps): React.JSX.Element {
  const [mode, setMode] = useState<ClickMode>(null)
  const [finder, setFinder] = useState<Finder>(null)
  const [listOpen, setListOpen] = useState(true)

  const photos = library?.photos
  const photoById = useMemo(() => new Map(photos?.map((p) => [p.id, p]) ?? []), [photos])
  const pins = useMemo(() => {
    const out: MapPin[] = []
    for (const r of preview.snapshot?.results ?? []) {
      if (r.position)
        out.push({ id: r.id, lat: r.position.lat, lon: r.position.lon, kind: r.status.kind })
      else if (r.status.kind === 'has-gps') {
        const gps = photoById.get(r.id)?.gps
        if (gps) out.push({ id: r.id, lat: gps.latitude, lon: gps.longitude, kind: 'has-gps' })
      }
    }
    return out
  }, [preview.snapshot, photoById])

  const counts = useMemo(() => statusCounts(statuses, scope), [statuses, scope])
  const notPlaced = useMemo(() => {
    const ids = new Set(notPlacedIds(statuses, scope))
    return (preview.snapshot?.results ?? []).filter((r) => ids.has(r.id))
  }, [preview.snapshot, statuses, scope])

  // A new selection, or a track whose geometry changed under the suggestions, starts from scratch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on these changes only
  useEffect(() => {
    setMode(null)
    setFinder(null)
  }, [selectedId, geometry])

  useEffect(() => {
    if (!mode && !finder) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setMode(null)
      setFinder(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, finder])

  const selected = selectedId ? (photoById.get(selectedId) ?? null) : null
  const selectedTime = selectedId ? utcs.get(selectedId) : undefined
  const selectedStatus = selectedId ? statuses.get(selectedId) : undefined

  const onMapClick = (at: { lat: number; lon: number }): void => {
    if (!selected) return
    if (mode === 'place') {
      onManual(selected.id, { lat: at.lat, lon: at.lon, ele: null })
      setMode(null)
      return
    }
    if (mode === 'find-offset' && geometry && selectedTime?.wall && selectedTime.utc) {
      const wall = selectedTime.wall
      const current = wallAsUtcSeconds(wall) - instantSeconds(selectedTime.utc)
      const candidates = findOffsetCandidates(
        geometry.points.map(([t, lat, lon]) => ({ t, lat, lon })),
        at,
        wall,
        current,
        { geoMaxIntSecs: geometry.geoMaxIntSecs },
      )
      setFinder({ candidates: candidates.slice(0, 3) })
      setMode(null)
    }
  }

  const onPinClick = (id: string): void => {
    if (mode === 'copy' && selected) {
      if (id === selected.id) return
      const source = preview.snapshot?.results.find((r) => r.id === id)
      const gps = photoById.get(id)?.gps
      const position =
        source?.position ??
        (gps ? { lat: gps.latitude, lon: gps.longitude, ele: gps.altitude } : null)
      if (position) onManual(selected.id, position)
      setMode(null)
      return
    }
    onSelect(id)
  }

  const canFind = !!(geometry && selectedTime?.utc)
  // Excluded files are never written, so a position for them would go nowhere.
  const excluded = selectedStatus?.kind === 'excluded'
  const empty = !library || !hasTrack

  return (
    <MapView
      mapSource={mapSource}
      mapRevision={mapRevision}
      geometry={geometry}
      pins={pins}
      selectedId={selectedId}
      clickMode={mode}
      onPinClick={onPinClick}
      onMapClick={onMapClick}
      renderHover={(id) => (
        <PinHover photo={photoById.get(id)} time={utcs.get(id)} status={statuses.get(id)} />
      )}
    >
      {empty && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="rounded-lg bg-background/90 px-5 py-4 text-center shadow-sm">
            <h1 className="font-semibold text-2xl tracking-tight">Stecknadel</h1>
            <p className="mt-1 text-muted-foreground">
              {library
                ? 'Open a GPX file or fetch from Dawarich to place the photos'
                : 'Open a folder of photos and a track to see where each was taken'}
            </p>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute top-3 left-3 flex max-h-[calc(100%-5rem)] w-72 max-w-[calc(100%-10rem)] flex-col gap-2">
        {(preview.running || preview.error) && !empty && (
          <div
            role="status"
            data-testid="preview-state"
            className={cn(
              'flex shrink-0 items-center gap-1.5 self-start rounded-full border bg-background/95 px-3 py-1 text-xs shadow-sm',
              preview.error && 'text-destructive',
            )}
          >
            {preview.error ? (
              `Preview failed: ${preview.error}`
            ) : (
              <>
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                Updating positions
              </>
            )}
          </div>
        )}
        {loadError && (
          <div
            role="alert"
            data-testid="load-error"
            className="pointer-events-auto flex items-center gap-1.5 self-start rounded-full border border-destructive/40 bg-background/95 px-3 py-1 text-destructive text-xs shadow-sm"
          >
            <span className="min-w-0 break-words">{loadError}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-1.5"
              disabled={retrying}
              onClick={onRetry}
            >
              Retry
            </Button>
          </div>
        )}
        {selected && !empty && (
          <div
            data-testid="photo-actions"
            className="pointer-events-auto flex min-h-0 flex-col gap-2 overflow-y-auto rounded-lg border bg-background/95 p-3 shadow-sm"
          >
            <h2 className="sr-only">{selected.name}</h2>
            {selectedStatus ? (
              <p data-testid="selected-status" className="flex items-start gap-2">
                <StatusDot kind={selectedStatus.kind} className="mt-1.5" />
                <span className="min-w-0">
                  <span className="font-medium">{STATUS_LABELS[selectedStatus.kind]}</span>
                  {statusDetail(selectedStatus) && (
                    <span className="block text-muted-foreground text-xs">
                      {statusDetail(selectedStatus)}
                    </span>
                  )}
                </span>
              </p>
            ) : null}
            {mode ? (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs">
                  {mode === 'copy'
                    ? 'Click the pin of the photo to copy from.'
                    : 'Click where this photo was taken.'}
                </p>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setMode(null)}>
                  Cancel
                </Button>
              </div>
            ) : finder ? (
              <FinderResult
                finder={finder}
                source={selectedTime?.source ?? null}
                onApply={(c) => {
                  onApplyOffset(selected, c)
                  setFinder(null)
                }}
                onRetry={() => {
                  setFinder(null)
                  setMode('find-offset')
                }}
                onClose={() => setFinder(null)}
              />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={!canFind}
                  title={
                    canFind
                      ? 'Click the map where this photo was taken to fix the camera time'
                      : undefined
                  }
                  onClick={() => setMode('find-offset')}
                >
                  <Crosshair />
                  Find offset
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={excluded}
                  onClick={() => setMode('place')}
                >
                  <Pin />
                  Place on map
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={excluded || pins.every((p) => p.id === selected.id)}
                  onClick={() => setMode('copy')}
                >
                  <Copy />
                  Copy location
                </Button>
                {selectedStatus?.kind === 'manual' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => onManual(selected.id, null)}
                  >
                    <X />
                    Remove placement
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {notPlaced.length > 0 && (
          <div
            data-testid="not-placed"
            className="pointer-events-auto flex min-h-0 flex-col rounded-lg border bg-background/95 shadow-sm"
          >
            <button
              type="button"
              aria-expanded={listOpen}
              onClick={() => setListOpen((o) => !o)}
              className="flex shrink-0 items-center gap-1.5 px-3 py-2 text-left font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {listOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              Not placed
              <span className="ml-auto text-muted-foreground tabular-nums">
                {notPlaced.length.toLocaleString()}
              </span>
            </button>
            {listOpen && (
              <ul className="min-h-0 overflow-y-auto border-t py-1">
                {notPlaced.slice(0, LIST_LIMIT).map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(r.id)}
                      aria-pressed={r.id === selectedId}
                      className={cn(
                        'flex w-full flex-col px-3 py-1 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent',
                        r.id === selectedId && 'bg-accent',
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <StatusDot kind={r.status.kind} />
                        <span className="truncate font-medium">{photoById.get(r.id)?.name}</span>
                      </span>
                      <span className="pl-4 text-muted-foreground">
                        {statusDetail(r.status) ?? STATUS_LABELS[r.status.kind]}
                      </span>
                    </button>
                  </li>
                ))}
                {notPlaced.length > LIST_LIMIT && (
                  <li className="px-3 py-1 text-muted-foreground text-xs">
                    and {(notPlaced.length - LIST_LIMIT).toLocaleString()} more
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      {counts.size > 0 && (
        <ul
          data-testid="legend"
          className="absolute bottom-8 left-3 flex flex-col gap-0.5 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm"
        >
          {[...counts]
            .sort((a, b) => b[1] - a[1])
            .map(([kind, count]) => (
              <li key={kind} className="flex items-center gap-2" data-kind={kind}>
                <StatusDot kind={kind} />
                <span className="flex-1">{STATUS_LABELS[kind]}</span>
                <span className="pl-3 text-muted-foreground tabular-nums">
                  {count.toLocaleString()}
                </span>
              </li>
            ))}
        </ul>
      )}
    </MapView>
  )
}

function StatusDot({
  kind,
  className,
}: {
  kind: MatchKind
  className?: string
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('size-2.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: STATUS_COLORS[kind] }}
    />
  )
}

const runs = (drift: number): string => {
  const s = Math.round(drift)
  return s === 0 ? 'runs on time' : `runs ${Math.abs(s)} s ${s > 0 ? 'fast' : 'slow'}`
}

/** What applying the suggestion means for this camera, in the plan's words. */
function candidateText(c: OffsetCandidate, source: PhotoUtc['source']): string {
  if (source === 'recorded-offset') {
    return c.stationary
      ? 'The recorded offset fits'
      : `Clock ${runs(c.correctionSeconds - c.offsetSeconds)} (recorded offset kept)`
  }
  const clock = `Clock set to ${offsetLabel(c.offset)}`
  return c.driftSeconds === null ? clock : `${clock}, ${runs(c.driftSeconds)}`
}

const utcTime = (seconds: number): string => `${formatInstant(secondsToInstant(seconds)).slice(11)}`

function FinderResult({
  finder,
  source,
  onApply,
  onRetry,
  onClose,
}: {
  finder: NonNullable<Finder>
  source: PhotoUtc['source']
  onApply: (candidate: OffsetCandidate) => void
  onRetry: () => void
  onClose: () => void
}): React.JSX.Element {
  if (finder.candidates.length === 0) {
    return (
      <div data-testid="finder-result" className="text-xs">
        <p>The track doesn’t pass within 150 m of there.</p>
        <div className="mt-1.5 flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7" onClick={onRetry}>
            Try again
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div data-testid="finder-result" className="flex flex-col gap-1.5 text-xs">
      {finder.candidates.map((c) => (
        <div
          key={`${c.trackUtc}`}
          data-testid="finder-candidate"
          className="flex items-center gap-2 rounded-md border px-2 py-1.5"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium tabular-nums">{candidateText(c, source)}</p>
            <p className="text-muted-foreground tabular-nums">
              {c.stationary
                ? `Stayed here ${utcTime(c.stationary.from)}–${utcTime(c.stationary.to)}`
                : `Track passed ${Math.round(c.distanceMeters)} m away at ${utcTime(c.trackUtc)}`}
            </p>
          </div>
          <Button size="sm" className="h-7" onClick={() => onApply(c)}>
            Apply
          </Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" className="h-7 self-start" onClick={onClose}>
        Cancel
      </Button>
    </div>
  )
}

function PinHover({
  photo,
  time,
  status,
}: {
  photo: PhotoSummary | undefined
  time: PhotoUtc | undefined
  status: MatchStatus | undefined
}): React.JSX.Element | null {
  return photo ? <PinHoverCard photo={photo} time={time} status={status} /> : null
}

function PinHoverCard({
  photo,
  time,
  status,
}: {
  photo: PhotoSummary
  time: PhotoUtc | undefined
  status: MatchStatus | undefined
}): React.JSX.Element {
  const thumb = useThumbnail(photo.id)
  return (
    <div className="flex gap-2">
      <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded bg-muted">
        {thumb?.url && (
          <img
            src={thumb.url}
            alt=""
            className="size-full object-cover"
            style={thumb.rotate ? { transform: `rotate(${thumb.rotate}deg)` } : undefined}
          />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium">{photo.name}</p>
        {time?.utc && (
          <p className="text-muted-foreground tabular-nums">{formatInstant(time.utc)}</p>
        )}
        {status && (
          <p>
            {STATUS_LABELS[status.kind]}
            {statusDetail(status) && (
              <span className="text-muted-foreground"> · {statusDetail(status)}</span>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
