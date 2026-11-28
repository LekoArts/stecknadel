import { PhotoContextMenu, type PhotoMenuProps } from '@renderer/components/PhotoContextMenu'
import { formatCaptureTime } from '@renderer/lib/format'
import { isMac } from '@renderer/lib/panels'
import {
  clickModifiers,
  clickSelection,
  EMPTY_SELECTION,
  type Selection,
  selectAll,
} from '@renderer/lib/selection'
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

/** Tile widths the size slider offers; thumbnails are 256 px, so larger would blur. */
export const TILE_WIDTHS = { min: 120, max: 280, default: 184 } as const
// Up to four 16px text lines, their gaps, padding and border.
const TEXT_HEIGHT = 90
const GAP = 8

const thumbHeight = (tileWidth: number): number => Math.round((tileWidth * 120) / 184)

interface PhotoGridProps extends PhotoMenuProps {
  photos: PhotoSummary[]
  cameraNames: Map<string, string>
  utcs: Map<string, PhotoUtc>
  /** Preview statuses; empty without a preview. */
  statuses: Map<string, MatchStatus>
  /** Hide the camera line when the grid is already filtered to one camera. */
  showCamera: boolean
  tileWidth: number
  selection: Selection
  onSelection: (next: Selection) => void
}

export function PhotoGrid({
  photos,
  cameraNames,
  utcs,
  statuses,
  showCamera,
  tileWidth,
  selection,
  onSelection,
  onWrite,
  writable,
}: PhotoGridProps): React.JSX.Element {
  const selectedId = selection.primary
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const tileHeight = thumbHeight(tileWidth) + TEXT_HEIGHT
  const columns = Math.max(1, Math.floor((width + GAP) / (tileWidth + GAP)))
  const rows = Math.ceil(photos.length / columns)
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => tileHeight + GAP,
    overscan: 2,
  })
  // Row heights are estimates: re-measure when the tile size changes.
  useEffect(() => {
    if (tileHeight) virtualizer.measure()
  }, [tileHeight, virtualizer])

  // Keep the selected photo in view (it may have been picked on the map).
  useEffect(() => {
    const index = photos.findIndex((p) => p.id === selectedId)
    if (index !== -1) virtualizer.scrollToIndex(Math.floor(index / columns), { align: 'auto' })
  }, [selectedId, photos, columns, virtualizer])

  const select = (id: string, e: React.MouseEvent): void =>
    onSelection(
      clickSelection(
        selection,
        id,
        clickModifiers(e, isMac),
        photos.map((p) => p.id),
      ),
    )

  return (
    <PhotoContextMenu
      selection={selection}
      onSelection={onSelection}
      onWrite={onWrite}
      writable={writable}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a background click-to-deselect; Escape is the keyboard path, the tiles are the controls */}
      <div
        ref={scrollRef}
        // Clicking anywhere inside focuses the view, so Escape and Cmd/Ctrl+A reach it.
        tabIndex={-1}
        data-testid="photo-grid"
        // Tiles outside the view aren't rendered: tests read the count here.
        data-selected-count={selection.ids.size}
        className="h-full select-none outline-none overflow-y-auto px-3 py-2 [scrollbar-gutter:stable]"
        // Clicking between or beside the tiles, or Escape, clears the selection.
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('[data-testid="photo-tile"]'))
            onSelection(EMPTY_SELECTION)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && selection.ids.size > 0) onSelection(EMPTY_SELECTION)
          if (e.key === 'a' && (isMac ? e.metaKey : e.ctrlKey)) {
            e.preventDefault()
            onSelection(
              selectAll(
                selection,
                photos.map((p) => p.id),
              ),
            )
          }
        }}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              className="absolute inset-x-0 flex"
              style={{ top: row.start, height: tileHeight, gap: GAP }}
            >
              {photos.slice(row.index * columns, row.index * columns + columns).map((photo) => (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  camera={showCamera ? cameraNames.get(photo.cameraKey) : undefined}
                  utc={utcs.get(photo.id)}
                  status={statuses.get(photo.id)}
                  selected={selection.ids.has(photo.id)}
                  width={tileWidth}
                  height={tileHeight}
                  onSelect={select}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </PhotoContextMenu>
  )
}

function PhotoTile({
  photo,
  camera,
  utc,
  status,
  selected,
  width,
  height,
  onSelect,
}: {
  photo: PhotoSummary
  camera: string | undefined
  utc: PhotoUtc | undefined
  status: MatchStatus | undefined
  selected: boolean
  width: number
  height: number
  onSelect: (id: string, e: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid="photo-tile"
      data-photo-id={photo.id}
      aria-pressed={selected}
      onClick={(e) => onSelect(photo.id, e)}
      className={cn(
        'flex shrink-0 flex-col overflow-hidden rounded-md border text-left outline-none',
        'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
        selected && 'border-primary bg-accent',
      )}
      style={{ width, height }}
    >
      <Thumbnail photo={photo} status={status} width={width} />
      <div className="flex min-w-0 flex-col gap-0.5 px-2.5 pt-2 pb-2.5 text-xs">
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
  width,
}: {
  photo: PhotoSummary
  status: MatchStatus | undefined
  width: number
}): React.JSX.Element {
  const thumb = useThumbnail(photo.id)
  const height = thumbHeight(width)
  return (
    <div
      className="relative grid w-full shrink-0 place-items-center overflow-hidden bg-muted"
      style={{ height }}
    >
      {thumb?.url ? (
        <img
          src={thumb.url}
          alt=""
          draggable={false}
          className={cn('object-cover', thumb.rotate % 180 === 0 ? 'size-full' : 'max-w-none')}
          // Turned a quarter, the image's box is the tile's box on its side.
          style={
            thumb.rotate
              ? {
                  transform: `rotate(${thumb.rotate}deg)`,
                  ...(thumb.rotate % 180 === 0 ? {} : { width: height, height: width }),
                }
              : undefined
          }
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

export function UtcLine({ time }: { time: PhotoUtc | undefined }): React.JSX.Element {
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
