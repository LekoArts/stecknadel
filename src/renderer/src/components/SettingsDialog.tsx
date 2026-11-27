import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
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
import {
  type MatchingSettings,
  type SaveSettingsInput,
  type SettingsView,
  saveSettingsSchema,
  type WritingSettings,
} from '@shared/settings'
import { Settings as SettingsIcon } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'

interface SettingsDialogProps {
  settings: SettingsView
  onSaved: (settings: SettingsView) => void
  /** A new PMTiles file became the map source (main saves it as soon as it's picked). */
  onPmtilesChosen: (settings: SettingsView) => void
}

type MapKind = SettingsView['mapSource']['kind']

/** The form keeps text as typed; numbers are parsed on save. */
interface Draft {
  maxIntMinutes: string
  maxExtMinutes: string
  bridgeEnabled: boolean
  bridgeRadius: string
  bridgeHours: string
  writing: WritingSettings
  mapKind: MapKind
  styleUrl: string
  pmtilesName: string | null
}

const toDraft = (s: SettingsView): Draft => ({
  maxIntMinutes: String(s.matching.geoMaxIntSecs / 60),
  maxExtMinutes: String(s.matching.geoMaxExtSecs / 60),
  bridgeEnabled: s.matching.bridge.enabled,
  bridgeRadius: String(s.matching.bridge.radiusMeters),
  bridgeHours: String(s.matching.bridge.maxGapHours),
  writing: s.writing,
  mapKind: s.mapSource.kind,
  styleUrl: s.mapSource.kind === 'style' ? s.mapSource.url : '',
  pmtilesName: s.mapSource.kind === 'pmtiles' ? s.mapSource.name : null,
})

const num = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text))

function fromDraft(d: Draft): SaveSettingsInput {
  const matching: MatchingSettings = {
    geoMaxIntSecs: Math.round(num(d.maxIntMinutes) * 60),
    geoMaxExtSecs: Math.round(num(d.maxExtMinutes) * 60),
    bridge: {
      enabled: d.bridgeEnabled,
      radiusMeters: num(d.bridgeRadius),
      maxGapHours: num(d.bridgeHours),
    },
  }
  const mapSource: SaveSettingsInput['mapSource'] =
    d.mapKind === 'style' ? { kind: 'style', url: d.styleUrl.trim() } : { kind: d.mapKind }
  return { matching, writing: d.writing, mapSource }
}

/** Field paths of the draft that fail validation, e.g. `matching.geoMaxIntSecs`. */
function invalidFields(d: Draft): Set<string> {
  const parsed = saveSettingsSchema.safeParse(fromDraft(d))
  const out = new Set<string>()
  if (!parsed.success) for (const issue of parsed.error.issues) out.add(issue.path.join('.'))
  if (d.mapKind === 'pmtiles' && !d.pmtilesName) out.add('mapSource')
  return out
}

export function SettingsDialog({
  settings,
  onSaved,
  onPmtilesChosen,
}: SettingsDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const ids = useId()

  const onOpenChange = (next: boolean): void => {
    if (saving) return
    if (next) {
      setDraft(toDraft(settings))
      setError(null)
    }
    setOpen(next)
  }
  const set = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }))
  const setWriting = (patch: Partial<WritingSettings>): void =>
    setDraft((d) => ({ ...d, writing: { ...d.writing, ...patch } }))

  const invalid = invalidFields(draft)

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      onSaved(await window.stecknadel.saveSettings(fromDraft(draft)))
      setOpen(false)
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const choosePmtiles = async (): Promise<void> => {
    setError(null)
    try {
      const next = await window.stecknadel.choosePmtiles()
      if (!next) return
      onPmtilesChosen(next)
      set({
        mapKind: 'pmtiles',
        pmtilesName: next.mapSource.kind === 'pmtiles' ? next.mapSource.name : null,
      })
    } catch (e) {
      setError(ipcErrorMessage(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Settings" title="Settings">
          <SettingsIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (invalid.size === 0) void save()
          }}
          className="grid gap-5"
        >
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription className="sr-only">
              Matching limits, gap bridging, writing options and the map
            </DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-3" disabled={saving}>
            <legend className="mb-2 font-medium">Matching</legend>
            <NumberRow
              id={`${ids}-int`}
              label="Interpolate between points up to"
              unit="min apart"
              value={draft.maxIntMinutes}
              onChange={(v) => set({ maxIntMinutes: v })}
              invalid={invalid.has('matching.geoMaxIntSecs')}
              hint="1 minute to 7 days"
            />
            <NumberRow
              id={`${ids}-ext`}
              label="Use the nearest point up to"
              unit="min away"
              value={draft.maxExtMinutes}
              onChange={(v) => set({ maxExtMinutes: v })}
              invalid={invalid.has('matching.geoMaxExtSecs')}
              hint="1 minute to 7 days"
            />
          </fieldset>

          <fieldset className="grid gap-3" disabled={saving}>
            <legend className="mb-2 font-medium">Stationary gaps</legend>
            <Check
              id={`${ids}-bridge`}
              checked={draft.bridgeEnabled}
              onChange={(v) => set({ bridgeEnabled: v })}
            >
              Bridge gaps where the track starts and ends at the same place
            </Check>
            <NumberRow
              id={`${ids}-radius`}
              label="Same place: within"
              unit="m"
              value={draft.bridgeRadius}
              onChange={(v) => set({ bridgeRadius: v })}
              invalid={invalid.has('matching.bridge.radiusMeters')}
              hint="10 to 5000 m, whole meters"
              disabled={!draft.bridgeEnabled}
            />
            <NumberRow
              id={`${ids}-hours`}
              label="Gaps up to"
              unit="h"
              value={draft.bridgeHours}
              onChange={(v) => set({ bridgeHours: v })}
              invalid={invalid.has('matching.bridge.maxGapHours')}
              hint="1 to 72 h, whole hours"
              disabled={!draft.bridgeEnabled}
            />
          </fieldset>

          <fieldset className="grid gap-3" disabled={saving}>
            <legend className="mb-2 font-medium">Writing</legend>
            <Check
              id={`${ids}-overwrite`}
              checked={draft.writing.overwriteGps}
              onChange={(v) => setWriting({ overwriteGps: v })}
            >
              Replace GPS positions photos already have
            </Check>
            <Check
              id={`${ids}-oto`}
              checked={draft.writing.writeOffsetTime}
              onChange={(v) => setWriting({ writeOffsetTime: v })}
            >
              Write the time zone offset (OffsetTimeOriginal)
            </Check>
            <Check
              id={`${ids}-backups`}
              checked={draft.writing.backups}
              onChange={(v) => setWriting({ backups: v })}
            >
              Keep a copy of each original file
            </Check>
            <div className="grid gap-1.5" role="radiogroup" aria-labelledby={`${ids}-raw`}>
              <span id={`${ids}-raw`} className="text-sm">
                For RAW files, write into
              </span>
              <Radio
                name={`${ids}-raw`}
                checked={draft.writing.rawTarget === 'in-file'}
                onChange={() => setWriting({ rawTarget: 'in-file' })}
              >
                The RAW file itself
              </Radio>
              <Radio
                name={`${ids}-raw`}
                checked={draft.writing.rawTarget === 'sidecar'}
                onChange={() => setWriting({ rawTarget: 'sidecar' })}
              >
                An .xmp sidecar next to it
              </Radio>
            </div>
          </fieldset>

          <fieldset className="grid gap-2" disabled={saving}>
            <legend className="mb-2 font-medium">Map</legend>
            <Radio
              name={`${ids}-map`}
              checked={draft.mapKind === 'openfreemap'}
              onChange={() => set({ mapKind: 'openfreemap' })}
            >
              OpenFreeMap
            </Radio>
            <Radio
              name={`${ids}-map`}
              checked={draft.mapKind === 'style'}
              onChange={() => set({ mapKind: 'style' })}
            >
              Map style URL
            </Radio>
            {draft.mapKind === 'style' && (
              <div className="grid gap-1 pl-6">
                <Label htmlFor={`${ids}-style`} className="sr-only">
                  Style address
                </Label>
                <Input
                  id={`${ids}-style`}
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  placeholder="https://example.com/style.json"
                  value={draft.styleUrl}
                  onChange={(e) => set({ styleUrl: e.target.value })}
                  aria-invalid={invalid.has('mapSource.url') || undefined}
                  autoFocus
                />
                {invalid.has('mapSource.url') && draft.styleUrl.trim() !== '' && (
                  <p className="text-destructive text-xs">Use an https:// address</p>
                )}
              </div>
            )}
            <Radio
              name={`${ids}-map`}
              checked={draft.mapKind === 'pmtiles'}
              onChange={() => set({ mapKind: 'pmtiles' })}
            >
              Offline map file (.pmtiles)
            </Radio>
            {draft.mapKind === 'pmtiles' && (
              <div className="flex items-center gap-2 pl-6">
                <span
                  className="min-w-0 flex-1 truncate text-muted-foreground"
                  data-testid="pmtiles-name"
                >
                  {draft.pmtilesName ?? 'No file chosen'}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void choosePmtiles()}
                >
                  Choose…
                </Button>
              </div>
            )}
          </fieldset>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || invalid.size > 0}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function NumberRow({
  id,
  label,
  unit,
  value,
  onChange,
  invalid,
  hint,
  disabled,
}: {
  id: string
  label: string
  unit: string
  value: string
  onChange: (value: string) => void
  invalid: boolean
  hint: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={id} className="flex-1 font-normal">
          {label}
        </Label>
        <Input
          id={id}
          inputMode="decimal"
          className="h-8 w-20 text-right tabular-nums"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-hint` : undefined}
          disabled={disabled}
        />
        <span className="w-20 whitespace-nowrap text-muted-foreground">{unit}</span>
      </div>
      {invalid && !disabled && (
        <p id={`${id}-hint`} className="text-right text-destructive text-xs">
          {hint}
        </p>
      )}
    </div>
  )
}

function Check({
  id,
  checked,
  onChange,
  children,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <Label htmlFor={id} className="font-normal leading-snug">
        {children}
      </Label>
    </div>
  )
}

function Radio({
  name,
  checked,
  onChange,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="radio"
        name={name}
        className="grid size-4 shrink-0 cursor-pointer appearance-none place-content-center rounded-full border border-input shadow-xs outline-none transition-[border-width,border-color] checked:border-[5px] checked:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
        checked={checked}
        onChange={onChange}
      />
      {children}
    </label>
  )
}
