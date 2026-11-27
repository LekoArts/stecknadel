import { ipcErrorMessage } from '@renderer/lib/ipc-error'
import type { MetadataGroups, PhotoSummary } from '@shared/library'
import { useEffect, useMemo, useState } from 'react'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; groups: MetadataGroups }

/** Read-only view of every tag in the selected photo, grouped by ExifTool family-1 group. */
export function MetadataPanel({ photo }: { photo: PhotoSummary | null }): React.JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!photo) return
    let current = true
    setState({ status: 'loading' })
    window.stecknadel.getMetadata({ id: photo.id }).then(
      (groups) => current && setState({ status: 'ready', groups }),
      (error: unknown) => current && setState({ status: 'error', message: ipcErrorMessage(error) }),
    )
    return () => {
      current = false
    }
  }, [photo])

  const filtered = useMemo(() => {
    if (state.status !== 'ready') return []
    const needle = filter.trim().toLowerCase()
    return Object.entries(state.groups)
      .map(([group, tags]) => {
        const groupMatches = group.toLowerCase().includes(needle)
        const rows = Object.entries(tags).filter(
          ([tag, value]) =>
            !needle ||
            groupMatches ||
            tag.toLowerCase().includes(needle) ||
            value.toLowerCase().includes(needle),
        )
        return [group, rows] as const
      })
      .filter(([, rows]) => rows.length > 0)
  }, [state, filter])

  if (!photo) {
    return <p className="px-4 py-3 text-muted-foreground">Select a photo to see its metadata.</p>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-4 py-3">
        <h2 className="truncate font-medium" title={photo.name}>
          {photo.name}
        </h2>
        <input
          type="search"
          aria-label="Filter tags"
          placeholder="Filter tags"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mt-2 h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>
      <div data-testid="metadata" className="min-h-0 flex-1 overflow-y-auto px-4 py-2 text-xs">
        {state.status === 'loading' && <p className="text-muted-foreground">Reading tags…</p>}
        {state.status === 'error' && (
          <p className="text-destructive">Couldn’t read this file: {state.message}</p>
        )}
        {state.status === 'ready' && filtered.length === 0 && (
          <p className="text-muted-foreground">No tags match “{filter.trim()}”.</p>
        )}
        {filtered.map(([group, rows]) => (
          <section key={group} className="mb-3">
            <h3 className="sticky top-0 bg-background py-1 font-medium text-muted-foreground">
              {group}
            </h3>
            <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-2">
              {rows.map(([tag, value]) => (
                <div key={tag} className="contents">
                  <dt className="truncate py-0.5 text-muted-foreground" title={tag}>
                    {tag}
                  </dt>
                  <dd className="select-text break-words py-0.5">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  )
}
