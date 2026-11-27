import { Button } from '@renderer/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@renderer/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { allZones, offsetLabel } from '@renderer/lib/time'
import { cn } from '@renderer/lib/utils'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Temporal } from 'temporal-polyfill'

export const FIXED_OFFSET = '__offset'

/** Plain substring match: fuzzy matching turns "van" into Antarctica/Vostok. */
const containsFilter = (value: string, search: string, keywords?: string[]): number => {
  const needle = search.trim().toLowerCase().replaceAll('−', '-')
  if (!needle) return 1
  return [value, ...(keywords ?? [])].some((k) =>
    k.toLowerCase().replaceAll('−', '-').includes(needle),
  )
    ? 1
    : 0
}

/** The zone's offset at `at` (or now), e.g. `UTC−07:00`. */
function offsetAt(zone: string, at: Temporal.Instant | null): string {
  return offsetLabel((at ?? Temporal.Now.instant()).toZonedDateTimeISO(zone).offset)
}

/**
 * Searchable time-zone picker. Zones on the trip come first; "Fixed UTC offset" picks
 * {@link FIXED_OFFSET}. Offsets are shown as they were at `at`, so DST reads right for the trip.
 */
export function ZonePicker({
  id,
  value,
  suggested,
  at,
  onChange,
  'aria-label': ariaLabel,
}: {
  id?: string
  /** An IANA zone, or {@link FIXED_OFFSET}. */
  value: string
  suggested: string[]
  at: Temporal.Instant | null
  onChange: (value: string) => void
  'aria-label'?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rest = useMemo(() => allZones().filter((z) => !suggested.includes(z)), [suggested])
  // The trigger is narrow: the city carries the meaning; the full zone is in the tooltip and list.
  const label =
    value === FIXED_OFFSET
      ? 'Fixed UTC offset'
      : (value.split('/').at(-1) ?? value).replaceAll('_', ' ')

  const item = (zone: string): React.JSX.Element => (
    <CommandItem
      key={zone}
      value={zone}
      keywords={[zone.replaceAll('_', ' '), offsetAt(zone, at)]}
      onSelect={() => {
        onChange(zone)
        setOpen(false)
      }}
    >
      <Check className={cn('size-3.5', zone === value ? 'opacity-100' : 'opacity-0')} />
      <span className="flex-1 truncate">{zone.replaceAll('_', ' ')}</span>
      <span className="text-muted-foreground text-xs tabular-nums">{offsetAt(zone, at)}</span>
    </CommandItem>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          title={value === FIXED_OFFSET ? undefined : value.replaceAll('_', ' ')}
          className="h-8 w-full justify-between px-2 font-normal"
        >
          <span className="truncate">{label}</span>
          {value !== FIXED_OFFSET && (
            <span className="ml-auto text-muted-foreground text-xs tabular-nums">
              {offsetAt(value, at)}
            </span>
          )}
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command filter={containsFilter}>
          <CommandInput placeholder="City, zone or offset" />
          <CommandList>
            <CommandEmpty>No zone found</CommandEmpty>
            {suggested.length > 0 && (
              <CommandGroup heading="On this trip">{suggested.map(item)}</CommandGroup>
            )}
            <CommandGroup>
              <CommandItem
                value={FIXED_OFFSET}
                keywords={['fixed', 'offset', 'utc']}
                onSelect={() => {
                  onChange(FIXED_OFFSET)
                  setOpen(false)
                }}
              >
                <Check
                  className={cn('size-3.5', value === FIXED_OFFSET ? 'opacity-100' : 'opacity-0')}
                />
                Fixed UTC offset
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="All zones">{rest.map(item)}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
