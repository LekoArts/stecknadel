/** A set of photos the Write confirmation offers; the first one offered is what the Write button means. */
export interface WriteScope {
  key: 'selection' | 'view' | 'camera' | 'all'
  label: string
  ids: readonly string[]
  /** Those with a position to write. */
  writable: readonly string[]
}

export interface ScopeInput {
  selected: readonly string[]
  /** The photos shown, when a camera or status filter hides some; null when unfiltered. */
  view: readonly string[] | null
  /** The primary selected photo's camera, when there is more than one camera. */
  camera: { name: string; ids: readonly string[] } | null
  all: readonly string[]
  canWrite: (id: string) => boolean
}

/**
 * Most specific first: the selection, the filtered view, the selected photo's camera, everything.
 * A scope that would write exactly what an earlier one writes is left out.
 */
export function writeScopes({ selected, view, camera, all, canWrite }: ScopeInput): WriteScope[] {
  const candidates: Omit<WriteScope, 'writable'>[] = []
  if (selected.length > 0)
    candidates.push({
      key: 'selection',
      label: selected.length === 1 ? 'Selected photo' : 'Selected photos',
      ids: selected,
    })
  if (view) candidates.push({ key: 'view', label: 'Photos in view', ids: view })
  if (camera && selected.length > 0)
    candidates.push({ key: 'camera', label: `All from ${camera.name}`, ids: camera.ids })
  candidates.push({ key: 'all', label: 'All photos', ids: all })

  const out: WriteScope[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    const writable = c.ids.filter(canWrite)
    const key = [...writable].sort().join(',')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...c, writable })
  }
  return out
}

/** Why the Write button is off for this scope. */
export function nothingToWrite(scope: WriteScope): string {
  switch (scope.key) {
    case 'selection':
      return scope.ids.length === 1
        ? 'The selected photo has no position to write'
        : 'None of the selected photos has a position to write'
    case 'view':
      return 'No photo in view has a position to write'
    case 'camera':
      return 'No photo from this camera has a position to write'
    case 'all':
      return 'No photo has a position to write'
  }
}
