import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  allZones,
  currentOffset,
  exifToInput,
  formatDrift,
  formatWall,
  localZone,
  tzLabel,
} from '@renderer/lib/time'
import type { CameraSummary } from '@shared/library'
import {
  type CameraTimeSettings,
  type Segment,
  type SegmentTz,
  splitAt,
} from '@shared/time/cameraSettings'
import { formatOffset, parseOffset } from '@shared/time/exifDate'
import { Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import { Temporal } from 'temporal-polyfill'

export interface CameraTimeStats {
  noTime: number
  ambiguous: number
  conflict: number
  recorded: number
}

interface CameraTimePanelProps {
  camera: CameraSummary
  settings: CameraTimeSettings
  stats: CameraTimeStats
  /** The selected photo's capture time when it belongs to this camera: the default split point. */
  selectedCaptureTime: string | null
  onChange: (settings: CameraTimeSettings) => void
}

const selectClass =
  'h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'

export function CameraTimePanel({
  camera,
  settings,
  stats,
  selectedCaptureTime,
  onChange,
}: CameraTimePanelProps): React.JSX.Element {
  const ids = useId()
  const update = (segments: Segment[]): void => onChange({ ...settings, segments, confirmed: true })

  return (
    <section
      aria-label={`Time settings for ${camera.name}`}
      data-testid="camera-time"
      className="flex flex-col gap-3 border-t px-4 py-3"
    >
      <div className="flex items-baseline gap-2">
        <h2 className="flex-1 truncate font-medium">Camera time</h2>
        {!settings.confirmed && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => onChange({ ...settings, confirmed: true })}
          >
            Confirm
          </Button>
        )}
      </div>
      {!settings.confirmed && (
        <p data-testid="unconfirmed" className="-mt-2 text-muted-foreground text-xs">
          Unconfirmed: this computer’s zone. Pick where the camera’s clock was set.
        </p>
      )}

      {camera.recordsOffsets && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 accent-primary"
            checked={settings.useRecordedOffsets}
            onChange={(e) =>
              onChange({ ...settings, useRecordedOffsets: e.target.checked, confirmed: true })
            }
          />
          <span>
            Use offsets recorded by the camera
            <span className="block text-muted-foreground text-xs tabular-nums">
              {stats.recorded.toLocaleString()} of {camera.count.toLocaleString()} photos have one
            </span>
          </span>
        </label>
      )}

      <ol className="flex flex-col gap-3" aria-label="Time segments">
        {settings.segments.map((segment, index) => (
          <SegmentEditor
            key={segment.startsAt ?? 'start'}
            idPrefix={`${ids}-${index}`}
            segment={segment}
            onChange={(next) => update(settings.segments.map((s, i) => (i === index ? next : s)))}
            onRemove={
              index === 0
                ? undefined
                : () => update(settings.segments.filter((_, i) => i !== index))
            }
          />
        ))}
      </ol>

      <AddTimeChange
        settings={settings}
        defaultAt={selectedCaptureTime}
        onAdd={(at) => onChange(splitAt(settings, at))}
      />

      {(stats.ambiguous > 0 || stats.conflict > 0 || stats.noTime > 0) && (
        <ul data-testid="time-warnings" className="flex flex-col gap-1 text-xs">
          {stats.conflict > 0 && (
            <li className="text-amber-700 dark:text-amber-400">
              Recorded offset differs from this setting on {plural(stats.conflict, 'photo')}
              {settings.useRecordedOffsets ? ' (the recorded one is used)' : ''}
            </li>
          )}
          {stats.ambiguous > 0 && (
            <li className="text-amber-700 dark:text-amber-400">
              {plural(stats.ambiguous, 'photo')} in a skipped or repeated DST hour
            </li>
          )}
          {stats.noTime > 0 && (
            <li className="text-muted-foreground">
              {plural(stats.noTime, 'photo')} without capture time
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

const plural = (n: number, word: string): string =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

const OFFSET_OPTION = '__offset'

function SegmentEditor({
  idPrefix,
  segment,
  onChange,
  onRemove,
}: {
  idPrefix: string
  segment: Segment
  onChange: (segment: Segment) => void
  onRemove?: () => void
}): React.JSX.Element {
  const label = segment.startsAt ? `From ${formatWall(segment.startsAt)}` : 'From the start'
  const setTz = (tz: SegmentTz): void => onChange({ ...segment, tz })

  return (
    <li data-testid="segment" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className="flex-1 text-muted-foreground text-xs tabular-nums">{label}</span>
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove the time change ${label.toLowerCase()}`}
            onClick={onRemove}
            className="grid size-5 place-items-center rounded text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <label className="sr-only" htmlFor={`${idPrefix}-tz`}>
        Time zone {label.toLowerCase()}
      </label>
      <select
        id={`${idPrefix}-tz`}
        className={selectClass}
        value={segment.tz.kind === 'zone' ? segment.tz.id : OFFSET_OPTION}
        onChange={(e) => {
          const value = e.target.value
          if (value === OFFSET_OPTION) {
            const zone = segment.tz.kind === 'zone' ? segment.tz.id : localZone()
            setTz({ kind: 'offset', value: currentOffset(zone) })
          } else setTz({ kind: 'zone', id: value })
        }}
      >
        <option value={OFFSET_OPTION}>Fixed UTC offset…</option>
        {allZones().map((zone) => (
          <option key={zone} value={zone}>
            {tzLabel({ kind: 'zone', id: zone })}
          </option>
        ))}
      </select>
      {segment.tz.kind === 'offset' && (
        <OffsetInput
          id={`${idPrefix}-offset`}
          value={segment.tz.value}
          onChange={(value) => setTz({ kind: 'offset', value })}
        />
      )}
      <details className="group text-xs" open={segment.driftSeconds !== 0 || undefined}>
        <summary className="w-fit cursor-pointer rounded text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          Advanced{segment.driftSeconds !== 0 && ` · clock ${formatDrift(segment.driftSeconds)}`}
        </summary>
        <DriftInput
          id={`${idPrefix}-drift`}
          value={segment.driftSeconds}
          onChange={(driftSeconds) => onChange({ ...segment, driftSeconds })}
        />
      </details>
    </li>
  )
}

function OffsetInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const parsed = parseOffset(draft)
  const commit = (): void => {
    if (parsed === null) setDraft(value)
    else {
      const normalized = formatOffset(parsed)
      setDraft(normalized)
      if (normalized !== value) onChange(normalized)
    }
  }
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-muted-foreground text-xs">
        UTC
      </label>
      <Input
        id={id}
        className="h-8 font-mono"
        value={draft}
        placeholder="−07:00"
        aria-invalid={parsed === null}
        onChange={(e) => setDraft(e.target.value.replace('−', '-'))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(value)
        }}
      />
    </div>
  )
}

function DriftInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  const parsed = draft.trim() === '' ? 0 : Number(draft)
  const valid = Number.isInteger(parsed) && Math.abs(parsed) <= 86_400
  const commit = (): void => {
    if (!valid) setDraft(String(value))
    else if (parsed !== value) onChange(parsed)
  }
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <label htmlFor={id} className="text-muted-foreground">
        Clock ahead by
      </label>
      <Input
        id={id}
        type="number"
        step={1}
        className="h-8 w-20 tabular-nums"
        value={draft}
        aria-invalid={!valid}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
      <span className="text-muted-foreground">s</span>
    </div>
  )
}

function AddTimeChange({
  settings,
  defaultAt,
  onAdd,
}: {
  settings: CameraTimeSettings
  defaultAt: string | null
  onAdd: (at: Temporal.PlainDateTime) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const id = useId()
  const at = parseInput(value)
  const taken =
    at !== null &&
    settings.segments.some((s) => s.startsAt === at.toString({ smallestUnit: 'second' }))

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() => {
          setValue(defaultAt ? exifToInput(defaultAt) : '')
          setOpen(true)
        }}
      >
        <Plus />
        Add time change at…
      </Button>
    )
  }
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (at && !taken) {
          onAdd(at)
          setOpen(false)
        }
      }}
    >
      <label htmlFor={id} className="text-muted-foreground text-xs">
        Camera time of the change{defaultAt ? ' (selected photo)' : ''}
      </label>
      <Input
        id={id}
        type="datetime-local"
        step={1}
        className="h-8"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={!at || taken}>
          Add
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function parseInput(value: string): Temporal.PlainDateTime | null {
  if (!value) return null
  try {
    return Temporal.PlainDateTime.from(value)
  } catch {
    return null
  }
}
