import { Button } from '@renderer/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList } from '@renderer/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { STATUS_GROUP_LABELS, STATUS_GROUPS, type StatusGroup } from '@renderer/lib/photoFilter'
import { cn } from '@renderer/lib/utils'
import type { CameraSummary } from '@shared/library'
import { Check, ChevronsUpDown, LayoutGrid, List } from 'lucide-react'
import { useState } from 'react'

export type PhotoView = 'grid' | 'list'

interface PhotosToolbarProps {
  view: PhotoView
  onView: (view: PhotoView) => void
  cameras: CameraSummary[]
  cameraFilter: string | null
  onCameraFilter: (key: string | null) => void
  /** Photos in each group under the current camera filter; null without a preview. */
  groupCounts: Record<StatusGroup, number> | null
  /** Photos under the current camera filter. */
  total: number
  statusFilter: StatusGroup | null
  onStatusFilter: (group: StatusGroup | null) => void
}

const segment =
  'h-7 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs'

export function PhotosToolbar({
  view,
  onView,
  cameras,
  cameraFilter,
  onCameraFilter,
  groupCounts,
  total,
  statusFilter,
  onStatusFilter,
}: PhotosToolbarProps): React.JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label="Photo view"
      className="flex shrink-0 items-center gap-2 overflow-x-auto border-b px-3 py-1.5"
    >
      <div className="flex shrink-0 rounded-lg bg-muted p-0.5">
        {(
          [
            ['grid', 'Grid', LayoutGrid],
            ['list', 'List', List],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={view === value}
            onClick={() => onView(value)}
            className={cn(segment, 'grid w-8 place-items-center px-0')}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
      {cameras.length > 1 && (
        <CameraPicker cameras={cameras} value={cameraFilter} onChange={onCameraFilter} />
      )}
      {groupCounts && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset can't lay out as a pill group
        <div role="group" aria-label="Status" className="flex shrink-0 rounded-lg bg-muted p-0.5">
          <button
            type="button"
            aria-pressed={statusFilter === null}
            onClick={() => onStatusFilter(null)}
            className={segment}
          >
            All <span className="tabular-nums opacity-70">{total.toLocaleString()}</span>
          </button>
          {STATUS_GROUPS.filter((g) => groupCounts[g] > 0 || statusFilter === g).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={statusFilter === g}
              onClick={() => onStatusFilter(statusFilter === g ? null : g)}
              className={segment}
            >
              {STATUS_GROUP_LABELS[g]}{' '}
              <span className="tabular-nums opacity-70">{groupCounts[g].toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CameraPicker({
  cameras,
  value,
  onChange,
}: {
  cameras: CameraSummary[]
  value: string | null
  onChange: (key: string | null) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const current = cameras.find((c) => c.key === value)
  const choose = (key: string | null): void => {
    onChange(key)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label="Camera"
          className="h-7 max-w-48 shrink-0 px-2 text-xs"
        >
          <span className="truncate">{current?.name ?? 'All cameras'}</span>
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem value="__all" onSelect={() => choose(null)}>
                <Check className={cn('size-3.5', value === null ? 'opacity-100' : 'opacity-0')} />
                <span className="flex-1">All cameras</span>
              </CommandItem>
              {cameras.map((c) => (
                <CommandItem
                  key={c.key}
                  value={c.key}
                  keywords={[c.name]}
                  onSelect={() => choose(c.key)}
                >
                  <Check
                    className={cn('size-3.5', value === c.key ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {c.count.toLocaleString()}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
