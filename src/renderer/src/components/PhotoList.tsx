import { UtcLine } from '@renderer/components/PhotoGrid'
import { formatCaptureTime } from '@renderer/lib/format'
import type { Sort, SortKey } from '@renderer/lib/photoFilter'
import { STATUS_COLORS } from '@renderer/lib/status'
import { useThumbnail } from '@renderer/lib/thumbnails'
import { cn } from '@renderer/lib/utils'
import type { PhotoSummary } from '@shared/library'
import { type MatchStatus, STATUS_LABELS, statusDetail } from '@shared/match/status'
import type { PhotoUtc } from '@shared/time/toUtc'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const ROW_HEIGHT = 36
/** The sticky header row, border included: rows start below it and scroll under it. */
const HEADER_HEIGHT = 32

interface Column {
  key: SortKey
  label: string
}

const WIDTHS_KEY = 'stecknadel.listColumns.v1'
/** Pixel widths. Name is a minimum: it also takes the space the others leave. */
const DEFAULT_WIDTHS: Record<SortKey, number> = {
  name: 128,
  camera: 160,
  captured: 208,
  utc: 152,
  status: 144,
}
const MIN_WIDTH = 64
const MAX_WIDTH = 640
const clampWidth = (w: number): number => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)))

function loadWidths(): Record<SortKey, number> {
  const widths = { ...DEFAULT_WIDTHS }
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? 'null')
    if (saved && typeof saved === 'object') {
      for (const key of Object.keys(widths) as SortKey[]) {
        const w = (saved as Record<string, unknown>)[key]
        if (typeof w === 'number' && Number.isFinite(w)) widths[key] = clampWidth(w)
      }
    }
  } catch {
    // Unreadable: defaults.
  }
  return widths
}

interface PhotoListProps {
  photos: PhotoSummary[]
  cameraNames: Map<string, string>
  utcs: Map<string, PhotoUtc>
  statuses: Map<string, MatchStatus>
  showCamera: boolean
  sort: Sort | null
  onSort: (sort: Sort | null) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function PhotoList({
  photos,
  cameraNames,
  utcs,
  statuses,
  showCamera,
  sort,
  onSort,
  selectedId,
  onSelect,
}: PhotoListProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [widths, setWidths] = useState(loadWidths)
  useEffect(() => {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths))
  }, [widths])
  const resize = (key: SortKey, width: number): void =>
    setWidths((w) => ({ ...w, [key]: clampWidth(width) }))

  const columns: Column[] = [
    { key: 'name', label: 'Name' },
    ...(showCamera ? [{ key: 'camera' as const, label: 'Camera' }] : []),
    { key: 'captured', label: 'Captured' },
    { key: 'utc', label: 'UTC' },
    ...(statuses.size ? [{ key: 'status' as const, label: 'Status' }] : []),
  ]
  // Thumbnail, then the sortable columns.
  const template = `2.5rem ${columns
    .map((c) => (c.key === 'name' ? `minmax(${widths.name}px,1fr)` : `${widths[c.key]}px`))
    .join(' ')}`

  const virtualizer = useVirtualizer({
    count: photos.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    scrollMargin: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
  })

  useEffect(() => {
    const index = photos.findIndex((p) => p.id === selectedId)
    if (index !== -1) virtualizer.scrollToIndex(index, { align: 'auto' })
  }, [selectedId, photos, virtualizer])

  // asc → desc → library order.
  const nextSort = (key: SortKey): Sort | null =>
    sort?.key !== key ? { key, dir: 'asc' } : sort.dir === 'asc' ? { key, dir: 'desc' } : null

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a background click-to-deselect; Escape is the keyboard path, the rows are the controls
    <div
      ref={scrollRef}
      data-testid="photo-list"
      className="h-full overflow-auto [scrollbar-gutter:stable]"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('[data-testid="photo-row"], th')) onSelect(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && selectedId) onSelect(null)
      }}
    >
      {/* Rows are positioned by the virtualizer, so the table lays out as a grid. */}
      <table aria-label="Photos" aria-rowcount={photos.length + 1} className="block min-w-fit">
        <thead className="sticky top-0 z-10 block bg-background">
          <tr
            aria-rowindex={1}
            className="grid border-b px-3 text-muted-foreground text-xs"
            style={{ gridTemplateColumns: template, height: HEADER_HEIGHT }}
          >
            <th>
              <span className="sr-only">Thumbnail</span>
            </th>
            {columns.map((c) => (
              <th
                key={c.key}
                className="relative"
                aria-sort={
                  sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                }
              >
                <button
                  type="button"
                  onClick={() => onSort(nextSort(c.key))}
                  className="flex h-full w-full items-center gap-1 px-2 text-left font-medium outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {c.label}
                  {sort?.key === c.key &&
                    (sort.dir === 'asc' ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    ))}
                </button>
                <ResizeHandle
                  label={c.label}
                  width={widths[c.key]}
                  onResize={(w) => resize(c.key, w)}
                  onReset={() => resize(c.key, DEFAULT_WIDTHS[c.key])}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="relative block" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const photo = photos[item.index]
            return (
              <Row
                key={photo.id}
                index={item.index}
                top={item.start - HEADER_HEIGHT}
                template={template}
                photo={photo}
                camera={showCamera ? (cameraNames.get(photo.cameraKey) ?? '') : null}
                utc={utcs.get(photo.id)}
                status={statuses.size ? (statuses.get(photo.id) ?? null) : undefined}
                selected={photo.id === selectedId}
                onSelect={onSelect}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Row({
  index,
  top,
  template,
  photo,
  camera,
  utc,
  status,
  selected,
  onSelect,
}: {
  index: number
  top: number
  template: string
  photo: PhotoSummary
  camera: string | null
  utc: PhotoUtc | undefined
  /** undefined: no status column. */
  status: MatchStatus | null | undefined
  selected: boolean
  onSelect: (id: string) => void
}): React.JSX.Element {
  const path = photo.relDir ? `${photo.relDir}/${photo.name}` : photo.name
  return (
    <tr
      aria-rowindex={index + 2}
      data-testid="photo-row"
      data-photo-id={photo.id}
      onClick={() => onSelect(photo.id)}
      className={cn(
        'absolute inset-x-0 grid items-center px-3 text-xs hover:bg-accent',
        selected && 'bg-accent',
      )}
      style={{ top, height: ROW_HEIGHT, gridTemplateColumns: template }}
    >
      <td>
        <RowThumb id={photo.id} />
      </td>
      <td className="min-w-0 px-2">
        <button
          type="button"
          title={path}
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(photo.id)
          }}
          className="block max-w-full truncate rounded-sm text-left font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {photo.name}
        </button>
      </td>
      {camera !== null && <td className="truncate px-2 text-muted-foreground">{camera}</td>}
      <td className="truncate px-2 text-muted-foreground tabular-nums">
        {photo.readError ? (
          <span className="text-destructive" title={photo.readError}>
            Unreadable
          </span>
        ) : photo.captureTime ? (
          formatCaptureTime(photo.captureTime, photo.offsetTimeOriginal)
        ) : (
          'No capture time'
        )}
      </td>
      <td className="min-w-0 px-2">
        <UtcLine time={utc} />
      </td>
      {status !== undefined && (
        <td className="min-w-0 px-2">
          {status && (
            <span
              data-testid="photo-status"
              data-status={status.kind}
              className="flex items-center gap-1.5"
              title={statusDetail(status) ?? undefined}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[status.kind] }}
              />
              <span className="truncate">{STATUS_LABELS[status.kind]}</span>
            </span>
          )}
        </td>
      )}
    </tr>
  )
}

function RowThumb({ id }: { id: string }): React.JSX.Element {
  const thumb = useThumbnail(id)
  return (
    <span className="relative grid size-7 place-items-center overflow-hidden rounded-sm bg-muted outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10">
      {thumb?.url && (
        <img
          src={thumb.url}
          alt=""
          draggable={false}
          className="size-full object-cover"
          style={thumb.rotate ? { transform: `rotate(${thumb.rotate}deg)` } : undefined}
        />
      )}
    </span>
  )
}

/** Drag (or arrow keys) to resize the column; double-click resets it. */
function ResizeHandle({
  label,
  width,
  onResize,
  onReset,
}: {
  label: string
  width: number
  onResize: (width: number) => void
  onReset: () => void
}): React.JSX.Element {
  const drag = useRef<{ x: number; width: number } | null>(null)
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter, which <hr> can't be
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      className="group absolute top-0 -right-1.5 z-10 flex h-full w-3 cursor-col-resize touch-none justify-center outline-none"
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        // From the drawn width: Name may be wider than its minimum.
        const drawn = e.currentTarget.parentElement?.getBoundingClientRect().width ?? width
        drag.current = { x: e.clientX, width: drawn }
      }}
      onPointerMove={(e) => {
        if (drag.current) onResize(drag.current.width + e.clientX - drag.current.x)
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onLostPointerCapture={() => {
        drag.current = null
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 32 : 8
        if (e.key === 'ArrowLeft') onResize(width - step)
        else if (e.key === 'ArrowRight') onResize(width + step)
        else if (e.key === 'Home' || e.key === 'Delete') onReset()
        else return
        e.preventDefault()
      }}
    >
      <span className="my-2 w-px bg-border group-hover:bg-foreground/40 group-focus-visible:w-0.5 group-focus-visible:bg-ring" />
    </div>
  )
}
