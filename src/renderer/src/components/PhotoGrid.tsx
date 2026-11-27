import { formatCaptureTime } from '@renderer/lib/format'
import { STATUS_COLORS } from '@renderer/lib/status'
import { useThumbnail } from '@renderer/lib/thumbnails'
import { formatInstant } from '@renderer/lib/time'
import { cn } from '@renderer/lib/utils'
import type { PhotoSummary } from '@shared/library'
import { type MatchStatus, STATUS_LABELS, statusDetail } from '@shared/match/status'
import type { PhotoUtc } from '@shared/time/toUtc'
import { useVirtualizer } from '@tanstack/react-virtual'
import { TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const TILE_WIDTH = 184
const TILE_HEIGHT = 196
const GAP = 8

interface PhotoGridProps {
  photos: PhotoSummary[]
  cameraNames: Map<string, string>
  utcs: Map<string, PhotoUtc>
  /** Preview statuses; empty without a preview. */
  statuses: Map<string, MatchStatus>
  /** Hide the camera line when the grid is already filtered to one camera. */
  showCamera: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}

export function PhotoGrid({
  photos,
  cameraNames,
  utcs,
  statuses,
  showCamera,
  selectedId,
  onSelect,
}: PhotoGridProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const columns = Math.max(1, Math.floor((width + GAP) / (TILE_WIDTH + GAP)))
  const rows = Math.ceil(photos.length / columns)
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TILE_HEIGHT + GAP,
    overscan: 2,
  })

  // Keep the selected photo in view (it may have been picked on the map).
  useEffect(() => {
    const index = photos.findIndex((p) => p.id === selectedId)
    if (index !== -1) virtualizer.scrollToIndex(Math.floor(index / columns), { align: 'auto' })
  }, [selectedId, photos, columns, virtualizer])

  return (
    <div
      ref={scrollRef}
      data-testid="photo-grid"
      className="h-full overflow-y-auto px-3 py-2 [scrollbar-gutter:stable]"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="absolute inset-x-0 flex"
            style={{ top: row.start, height: TILE_HEIGHT, gap: GAP }}
          >
            {photos.slice(row.index * columns, row.index * columns + columns).map((photo) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                camera={showCamera ? cameraNames.get(photo.cameraKey) : undefined}
                utc={utcs.get(photo.id)}
                status={statuses.get(photo.id)}
                selected={photo.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function PhotoTile({
  photo,
  camera,
  utc,
  status,
  selected,
  onSelect,
}: {
  photo: PhotoSummary
  camera: string | undefined
  utc: PhotoUtc | undefined
  status: MatchStatus | undefined
  selected: boolean
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid="photo-tile"
      data-photo-id={photo.id}
      aria-pressed={selected}
      onClick={() => onSelect(photo.id)}
      className={cn(
        'flex shrink-0 flex-col overflow-hidden rounded-md border text-left outline-none',
        'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
        selected && 'border-primary bg-accent',
      )}
      style={{ width: TILE_WIDTH, height: TILE_HEIGHT }}
    >
      <Thumbnail photo={photo} status={status} />
      <div className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5 text-xs">
        <span
          className="truncate font-medium"
          title={photo.relDir ? `${photo.relDir}/${photo.name}` : photo.name}
        >
          {photo.name}
        </span>
        {camera && <span className="truncate text-muted-foreground">{camera}</span>}
        <span className="truncate text-muted-foreground tabular-nums">
          {photo.readError ? (
            <span className="text-destructive" title={photo.readError}>
              Unreadable
            </span>
          ) : photo.captureTime ? (
            formatCaptureTime(photo.captureTime, photo.offsetTimeOriginal)
          ) : (
            'No capture time'
          )}
        </span>
        <UtcLine time={utc} />
      </div>
    </button>
  )
}

function Thumbnail({
  photo,
  status,
}: {
  photo: PhotoSummary
  status: MatchStatus | undefined
}): React.JSX.Element {
  const thumb = useThumbnail(photo.id)
  return (
    <div className="relative grid h-[120px] w-full shrink-0 place-items-center overflow-hidden bg-muted">
      {thumb?.url ? (
        <img
          src={thumb.url}
          alt=""
          draggable={false}
          className={cn(
            'object-cover',
            thumb.rotate % 180 === 0 ? 'size-full' : 'h-[184px] w-[120px] max-w-none',
          )}
          style={thumb.rotate ? { transform: `rotate(${thumb.rotate}deg)` } : undefined}
        />
      ) : thumb === undefined ? null : (
        <span className="font-medium text-muted-foreground text-xs">{photo.format}</span>
      )}
      {/* A hairline so light photos don't bleed into the tile background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 shadow-[inset_0_-1px_0_rgb(0_0_0/0.08)] dark:shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]"
      />
      {photo.gps && !status && (
        <span className="absolute top-1 right-1 rounded bg-background/85 px-1 font-medium text-[10px]">
          GPS
        </span>
      )}
      {status && (
        <span
          data-testid="photo-status"
          data-status={status.kind}
          role="img"
          aria-label={STATUS_LABELS[status.kind]}
          title={[STATUS_LABELS[status.kind], statusDetail(status)].filter(Boolean).join(': ')}
          className="absolute bottom-1 left-1 size-3 rounded-full border-2 border-background"
          style={{ backgroundColor: STATUS_COLORS[status.kind] }}
        />
      )}
    </div>
  )
}

const WARNING_TEXT = {
  'ambiguous-local-time': 'In a skipped or repeated DST hour',
  'offset-conflict': 'The recorded offset differs from the camera setting',
} as const

function UtcLine({ time }: { time: PhotoUtc | undefined }): React.JSX.Element {
  if (!time?.utc) return <span className="truncate text-muted-foreground">UTC —</span>
  const warning = time.warnings.map((w) => WARNING_TEXT[w]).join('. ')
  return (
    <span
      data-testid="photo-utc"
      className="flex items-center gap-1 truncate text-muted-foreground tabular-nums"
      title={warning || undefined}
    >
      <span className="truncate">{formatInstant(time.utc)}</span>
      {warning && (
        <TriangleAlert
          aria-label={warning}
          className="size-3 shrink-0 text-amber-700 dark:text-amber-400"
        />
      )}
    </span>
  )
}
