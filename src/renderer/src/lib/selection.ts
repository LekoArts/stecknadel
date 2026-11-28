/** Which photos are selected. `primary` is the one the map and metadata show; `anchor` is where a Shift-click range starts. */
export interface Selection {
  ids: ReadonlySet<string>
  primary: string | null
  anchor: string | null
}

export interface ClickModifiers {
  /** Cmd on macOS, Ctrl elsewhere: add or remove one photo. */
  toggle: boolean
  /** Shift: everything between the anchor and this photo. */
  range: boolean
}

export const EMPTY_SELECTION: Selection = { ids: new Set(), primary: null, anchor: null }

export const only = (id: string | null): Selection =>
  id === null ? EMPTY_SELECTION : { ids: new Set([id]), primary: id, anchor: id }

/** The selection after clicking `id`; `order` is the photos as shown. */
export function clickSelection(
  current: Selection,
  id: string,
  mods: ClickModifiers,
  order: readonly string[],
): Selection {
  if (mods.range && current.anchor !== null) {
    const from = order.indexOf(current.anchor)
    const to = order.indexOf(id)
    if (from !== -1 && to !== -1) {
      const span = order.slice(Math.min(from, to), Math.max(from, to) + 1)
      const ids = new Set(mods.toggle ? [...current.ids, ...span] : span)
      return { ids, primary: id, anchor: current.anchor }
    }
  }
  if (mods.toggle) {
    const ids = new Set(current.ids)
    if (ids.delete(id)) {
      const primary = current.primary === id ? ([...ids].at(-1) ?? null) : current.primary
      return { ids, primary, anchor: primary }
    }
    ids.add(id)
    return { ids, primary: id, anchor: id }
  }
  return only(id)
}

/** Every photo shown; the primary stays if it is one of them. */
export function selectAll(current: Selection, order: readonly string[]): Selection {
  if (order.length === 0) return current
  const primary =
    current.primary !== null && order.includes(current.primary) ? current.primary : order[0]
  return { ids: new Set(order), primary, anchor: current.anchor ?? primary }
}

/** Right-click: a photo outside the selection becomes the selection, as in Finder and Explorer. */
export const contextSelection = (current: Selection, id: string): Selection =>
  current.ids.has(id) ? current : only(id)

/** Modifiers from a click: Cmd on macOS, Ctrl on Windows. */
export const clickModifiers = (
  e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  mac: boolean,
): ClickModifiers => ({ toggle: mac ? e.metaKey : e.ctrlKey, range: e.shiftKey })
