import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/components/ui/context-menu'
import { contextSelection, type Selection } from '@renderer/lib/selection'
import { MapPinCheck } from 'lucide-react'
import { useState } from 'react'

export interface PhotoMenuProps {
  /** Opens the write confirmation; the right-clicked photo is in the selection by then. */
  onWrite: () => void
  /** How many of these photos have a position to write. */
  writable: (ids: readonly string[]) => number
}

/** Right-clicking a photo in the grid or list: it joins (or becomes) the selection, then Write. */
export function PhotoContextMenu({
  selection,
  onSelection,
  onWrite,
  writable,
  children,
}: PhotoMenuProps & {
  selection: Selection
  onSelection: (next: Selection) => void
  children: React.ReactElement
}): React.JSX.Element {
  const [target, setTarget] = useState<string | null>(null)
  const ids = target === null ? [] : selection.ids.has(target) ? [...selection.ids] : [target]
  const count = writable(ids)
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger
        asChild
        onContextMenu={(e) => {
          const id = (e.target as HTMLElement).closest<HTMLElement>('[data-photo-id]')?.dataset
            .photoId
          if (!id) {
            e.preventDefault()
            return
          }
          setTarget(id)
          onSelection(contextSelection(selection, id))
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem data-testid="menu-write" disabled={count === 0} onSelect={onWrite}>
          <MapPinCheck />
          {count === 0
            ? 'No position to write'
            : ids.length > 1
              ? `Write selected photos (${count})`
              : 'Write this photo'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
