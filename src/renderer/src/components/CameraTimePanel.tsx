import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { FIXED_OFFSET, ZonePicker } from '@renderer/components/ZonePicker'
import {
  currentOffset,
  exifToInput,
  formatDrift,
  formatWall,
  localZone,
  offsetLabel,
  parseWallInput,
} from '@renderer/lib/time'
import { cn } from '@renderer/lib/utils'
import type { CameraSummary } from '@shared/library'
import {
  type CameraTimeSettings,
  type Segment,
  type SegmentTz,
  splitAt,
} from '@shared/time/cameraSettings'
import { formatOffset, parseExifDateTime, parseOffset } from '@shared/time/exifDate'
import { ChevronRight, Copy, Plus, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Temporal } from 'temporal-polyfill'

export interface CameraTimeStats {
  noTime: number
  ambiguous: number
  conflict: number
  recorded: number
  /** Distinct offsets the camera recorded, sorted. */
  offsets: string[]
  /** The earliest capture time (EXIF format), for showing zone offsets as they were. */
  first: string | null
}

/** Where the settings came from: the computer's zone, the track, or the user. */
export type TimeOrigin = 'default' | 'track' | 'user'

export interface CopySource {
  key: string
  name: string
  label: string
}

interface CameraTimePanelProps {
  camera: CameraSummary
  settings: CameraTimeSettings
  origin: TimeOrigin
  stats: CameraTimeStats
  /** Zones the track passes through: offered first. */
  tripZones: string[]
  /** Other cameras whose zones and changes can be copied. */
  copySources: CopySource[]
  /** The selected photo's capture time when it belongs to this camera: the default change point. */
  selectedCaptureTime: string | null
  onChange: (settings: CameraTimeSettings) => void
  onCopyFrom: (key: string) => void
}

/** Every photo carries its own offset and it's used: the zone settings don't apply. */
export const allRecorded = (settings: CameraTimeSettings, stats: CameraTimeStats, count: number) =>
  settings.useRecordedOffsets && count > 0 && stats.recorded === count

export function CameraTimePanel({
  camera,
  settings,
  origin,
  stats,
  tripZones,
  copySources,
  selectedCaptureTime,
  onChange,
  onCopyFrom,
}: CameraTimePanelProps): React.JSX.Element {
  const ids = useId()
  const update = (segments: Segment[]): void => onChange({ ...settings, segments, confirmed: true })
  const recordedOnly = allRecorded(settings, stats, camera.count)
  const firstInstant = useMemo(() => {
    const wall = stats.first ? parseExifDateTime(stats.first) : null
    return wall ? wall.toZonedDateTime('UTC').toInstant() : null
  }, [stats.first])

  return (
    <section
      aria-label={`Time settings for ${camera.name}`}
      data-testid="camera-time"
      className="flex flex-col gap-3 border-t px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <h2 className="flex-1 truncate font-medium">Camera time</h2>
        {!recordedOnly && copySources.length > 0 && (
          <CopyFrom sources={copySources} onPick={onCopyFrom} />
        )}
      </div>

      {camera.recordsOffsets && (
        <label
          htmlFor={`${ids}-recorded`}
          className="flex items-start gap-2"
          data-testid={recordedOnly ? 'recorded-only' : 'recorded-offsets'}
        >
          <Checkbox
            id={`${ids}-recorded`}
            className="mt-0.5"
            checked={settings.useRecordedOffsets}
            onCheckedChange={(checked) =>
              onChange({ ...settings, useRecordedOffsets: checked === true, confirmed: true })
            }
          />
          <span>
            Use the time zone saved in each photo
            {/* When it's used for every photo, the camera row already names the offsets. */}
            {!recordedOnly && (
              <span className="block text-muted-foreground text-xs tabular-nums">
                {stats.recorded === camera.count
                  ? `Every photo has one: ${stats.offsets.map(offsetLabel).join(', ')}`
                  : `${stats.recorded.toLocaleString()} of ${camera.count.toLocaleString()} photos have one`}
              </span>
            )}
          </span>
        </label>
      )}

      {!recordedOnly && (
        <>
          <OriginNote
            origin={origin}
            onConfirm={() => onChange({ ...settings, confirmed: true })}
          />
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground text-xs">
              {camera.recordsOffsets
                ? 'Without a saved zone, the clock was set to'
                : 'Clock set to'}
            </h3>
            <ol className="flex flex-col gap-3" aria-label="Time zones">
              {settings.segments.map((segment, index) => (
                <SegmentEditor
                  key={segment.startsAt ?? 'start'}
                  idPrefix={`${ids}-${index}`}
                  segment={segment}
                  tripZones={tripZones}
                  at={
                    segment.startsAt
                      ? Temporal.PlainDateTime.from(segment.startsAt)
                          .toZonedDateTime('UTC')
                          .toInstant()
                      : firstInstant
                  }
                  onChange={(next) =>
                    update(settings.segments.map((s, i) => (i === index ? next : s)))
                  }
                  onRemove={
                    index === 0
                      ? undefined
                      : () => update(settings.segments.filter((_, i) => i !== index))
                  }
                />
              ))}
            </ol>
          </div>
          <AddTimeChange
            settings={settings}
            defaultAt={selectedCaptureTime}
            onAdd={(at) => onChange(splitAt(settings, at))}
          />
        </>
      )}

      {(stats.ambiguous > 0 || stats.conflict > 0 || stats.noTime > 0) && (
        <ul data-testid="time-warnings" className="flex flex-col gap-1 text-xs">
          {stats.conflict > 0 && (
            <li className="text-amber-700 dark:text-amber-400">
              Saved time zone differs from this setting on {plural(stats.conflict, 'photo')}
              {settings.useRecordedOffsets ? ' (the saved one is used)' : ''}
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

function OriginNote({
  origin,
  onConfirm,
}: {
  origin: TimeOrigin
  onConfirm: () => void
}): React.JSX.Element | null {
  if (origin === 'track') {
    return (
      <p data-testid="detected" className="-mt-1 text-muted-foreground text-xs">
        Detected from the track, assuming the clock showed local time.
      </p>
    )
  }
  if (origin === 'default') {
    return (
      <div
        data-testid="unconfirmed"
        className="-mt-1 flex items-start gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-amber-900 text-xs dark:bg-amber-950/40 dark:text-amber-200"
      >
        <p className="flex-1">Guessed from this computer. Loading a track detects it.</p>
        <Button size="xs" variant="outline" onClick={onConfirm}>
          Keep
        </Button>
      </div>
    )
  }
  return null
}

function CopyFrom({
  sources,
  onPick,
}: {
  sources: CopySource[]
  onPick: (key: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="ghost">
          <Copy />
          Copy from camera
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1" aria-label="Copy time zones from">
        <ul>
          {sources.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => {
                  onPick(s.key)
                  setOpen(false)
                }}
              >
                <span className="truncate">{s.name}</span>
                <span className="truncate text-muted-foreground text-xs">{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function SegmentEditor({
  idPrefix,
  segment,
  tripZones,
  at,
  onChange,
  onRemove,
}: {
  idPrefix: string
  segment: Segment
  tripZones: string[]
  at: Temporal.Instant | null
  onChange: (segment: Segment) => void
  onRemove?: () => void
}): React.JSX.Element {
  const label = segment.startsAt ? `From ${formatWall(segment.startsAt)}` : 'From the first photo'
  const setTz = (tz: SegmentTz): void => onChange({ ...segment, tz })

  return (
    <li data-testid="segment" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className="flex-1 text-xs tabular-nums">{label}</span>
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove the change ${label.toLowerCase()}`}
            onClick={onRemove}
            className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <ZonePicker
        id={`${idPrefix}-tz`}
        aria-label={`Time zone ${label.toLowerCase()}`}
        value={segment.tz.kind === 'zone' ? segment.tz.id : FIXED_OFFSET}
        suggested={tripZones}
        at={at}
        onChange={(value) => {
          if (value === FIXED_OFFSET) {
            if (segment.tz.kind === 'offset') return
            const zone = segment.tz.id || localZone()
            setTz({
              kind: 'offset',
              value: at ? at.toZonedDateTimeISO(zone).offset : currentOffset(zone),
            })
          } else setTz({ kind: 'zone', id: value })
        }}
      />
      {segment.tz.kind === 'offset' && (
        <OffsetInput
          id={`${idPrefix}-offset`}
          value={segment.tz.value}
          onChange={(value) => setTz({ kind: 'offset', value })}
        />
      )}
      <DriftEditor
        id={`${idPrefix}-drift`}
        value={segment.driftSeconds}
        onChange={(driftSeconds) => onChange({ ...segment, driftSeconds })}
      />
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
  // Copying another camera's zones changes the offset from outside: show it, don't keep the old.
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setDraft(value)
  }
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
    <div className="flex flex-col gap-1">
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
          aria-describedby={`${id}-hint`}
          onChange={(e) => setDraft(e.target.value.replace('−', '-'))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setDraft(value)
          }}
        />
      </div>
      <p id={`${id}-hint`} className="text-muted-foreground text-xs">
        The same all year, without daylight saving.
      </p>
    </div>
  )
}

export function DriftEditor({
  id,
  value,
  onChange,
}: {
  id: string
  value: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(value !== 0)
  const [draft, setDraft] = useState(value === 0 ? '' : String(Math.abs(value)))
  // Direction is a choice, not a sign the user has to remember.
  const [slow, setSlow] = useState(value < 0)
  // The offset finder and "copy from camera" change the drift from outside: show their value.
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setDraft(value === 0 ? '' : String(Math.abs(value)))
    setSlow(value < 0)
  }
  const parsed = draft.trim() === '' ? 0 : Number(draft)
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 86_400
  const apply = (seconds: number, isSlow: boolean): void => {
    const next = isSlow ? -seconds : seconds
    if (next !== value) onChange(next)
  }
  const commit = (): void => {
    if (!valid) setDraft(value === 0 ? '' : String(Math.abs(value)))
    else apply(parsed, slow)
  }
  return (
    <div className="text-xs">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronRight
          className={cn(
            'size-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        {value === 0 ? 'Clock fast or slow' : `Clock ${formatDrift(value)}`}
      </button>
      {open && (
        <div id={id} className="mt-1.5 flex items-center gap-2 pl-4.5">
          <Input
            id={`${id}-input`}
            aria-label="Seconds off"
            inputMode="numeric"
            placeholder="0"
            className="h-7 w-16 text-right tabular-nums"
            value={draft}
            aria-invalid={!valid}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
            }}
          />
          <span className="text-muted-foreground">s</span>
          <fieldset className="flex rounded-md border p-0.5">
            <legend className="sr-only">Direction</legend>
            {(['fast', 'slow'] as const).map((d) => {
              const pressed = (d === 'slow') === slow
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => {
                    const isSlow = d === 'slow'
                    setSlow(isSlow)
                    if (valid) apply(parsed, isSlow)
                  }}
                  className={cn(
                    'rounded-sm px-2 py-0.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    pressed ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {d === 'fast' ? 'Fast' : 'Slow'}
                </button>
              )
            })}
          </fieldset>
        </div>
      )}
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
  const at = parseWallInput(value)
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
        Add zone change
      </Button>
    )
  }
  return (
    <form
      className="flex flex-col gap-1.5 rounded-md border p-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (at && !taken) {
          onAdd(at)
          setOpen(false)
        }
      }}
    >
      <label htmlFor={id} className="text-xs">
        Camera time of the first photo in the new zone
      </label>
      <Input
        id={id}
        className="h-8 tabular-nums"
        placeholder="YYYY-MM-DD HH:MM:SS"
        value={value}
        autoFocus
        aria-invalid={value !== '' && (at === null || taken)}
        aria-describedby={taken ? `${id}-hint` : undefined}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {taken && (
        <p id={`${id}-hint`} className="text-destructive text-xs">
          There’s already a change at this time
        </p>
      )}
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
