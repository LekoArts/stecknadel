import { cn } from '@renderer/lib/utils'
import type { CameraSummary } from '@shared/library'
import { Pencil } from 'lucide-react'
import { useState } from 'react'

export interface CameraTimeLabel {
  text: string
  unconfirmed: boolean
}

interface CameraListProps {
  cameras: CameraSummary[]
  timeLabels: Map<string, CameraTimeLabel>
  total: number
  selectedKey: string | null
  onSelect: (key: string | null) => void
  onRename: (key: string, name: string) => Promise<void>
}

export function CameraList({
  cameras,
  timeLabels,
  total,
  selectedKey,
  onSelect,
  onRename,
}: CameraListProps): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-0.5 px-2" aria-label="Camera list">
      <li>
        <button
          type="button"
          aria-pressed={selectedKey === null}
          onClick={() => onSelect(null)}
          className={rowClass(selectedKey === null)}
        >
          <span className="flex-1 truncate">All photos</span>
          <span className="text-muted-foreground tabular-nums">{total}</span>
        </button>
      </li>
      {cameras.map((camera) => (
        <CameraRow
          key={camera.key}
          camera={camera}
          time={timeLabels.get(camera.key)}
          selected={camera.key === selectedKey}
          onSelect={() => onSelect(camera.key === selectedKey ? null : camera.key)}
          onRename={(name) => onRename(camera.key, name)}
        />
      ))}
    </ul>
  )
}

const rowClass = (selected: boolean): string =>
  cn(
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none',
    'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
    selected && 'bg-accent font-medium',
  )

function CameraRow({
  camera,
  time,
  selected,
  onSelect,
  onRename,
}: {
  camera: CameraSummary
  time: CameraTimeLabel | undefined
  selected: boolean
  onSelect: () => void
  onRename: (name: string) => Promise<void>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(camera.name)
  const [error, setError] = useState<string | null>(null)
  const renamed = camera.name !== camera.defaultName

  const commit = async (): Promise<void> => {
    if (draft.trim() === camera.name) {
      setEditing(false)
      return
    }
    try {
      await onRename(draft)
      setError(null)
      setEditing(false)
    } catch {
      setError('Couldn’t save the name')
    }
  }

  return (
    <li data-testid="camera" data-camera-key={camera.key} className="group relative">
      {editing ? (
        <form
          className="px-2 py-1"
          onSubmit={(e) => {
            e.preventDefault()
            void commit()
          }}
        >
          <input
            // biome-ignore lint/a11y/noAutofocus: focus moves into the field the user just asked to edit
            autoFocus
            aria-label={`Name for ${camera.defaultName}`}
            value={draft}
            maxLength={100}
            placeholder={camera.defaultName}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft(camera.name)
                setError(null)
                setEditing(false)
              }
            }}
            className="h-7 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          {error && <p className="mt-1 text-destructive text-xs">{error}</p>}
        </form>
      ) : (
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className={rowClass(selected)}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate" data-testid="camera-name">
              {camera.name}
            </span>
            {renamed && (
              <span className="truncate font-normal text-muted-foreground text-xs">
                {camera.defaultName}
              </span>
            )}
            {time && (
              <span
                data-testid="camera-time-label"
                className="truncate font-normal text-muted-foreground text-xs"
              >
                {time.text}
                {time.unconfirmed && (
                  <span className="text-amber-700 dark:text-amber-400"> · unconfirmed</span>
                )}
              </span>
            )}
            <span className="mt-1 flex flex-wrap gap-1">
              {camera.formats.map((format) => (
                <Badge key={format}>{format}</Badge>
              ))}
              {camera.recordsOffsets && <Badge>Records offsets</Badge>}
            </span>
          </span>
          <span className="self-start text-muted-foreground tabular-nums">{camera.count}</span>
        </button>
      )}
      {!editing && (
        <button
          type="button"
          aria-label={`Rename ${camera.name}`}
          onClick={() => {
            setDraft(camera.name)
            setEditing(true)
          }}
          className="absolute right-9 top-1.5 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-background focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 group-hover:opacity-100"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
    </li>
  )
}

function Badge({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="rounded border px-1 font-normal text-[10px] text-muted-foreground leading-4">
      {children}
    </span>
  )
}
