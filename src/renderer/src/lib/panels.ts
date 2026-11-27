import { useEffect, useRef, useState } from 'react'
import { type PanelImperativeHandle, type PanelSize, usePanelRef } from 'react-resizable-panels'

export type PanelId = 'cameras' | 'photos' | 'metadata'
export const PANEL_IDS: PanelId[] = ['cameras', 'photos', 'metadata']

/** Pixels: the size a panel opens at the first time, and the smallest it stays usable at. */
export const PANEL_DEFAULT: Record<PanelId, number> = { cameras: 288, photos: 288, metadata: 320 }
export const PANEL_MIN: Record<PanelId, number> = { cameras: 240, photos: 150, metadata: 240 }

export const PANEL_LABEL: Record<PanelId, string> = {
  cameras: 'Cameras',
  photos: 'Photos',
  metadata: 'Metadata',
}
export const PANEL_KEY: Record<PanelId, string> = { cameras: '1', photos: '2', metadata: '3' }

const SIZES_KEY = 'stecknadel.panelSizes.v1'
const HIDDEN_KEY = 'stecknadel.mapOnlyRestore.v1'

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

/** Saved sizes that still make sense; anything else is dropped. */
function readSizes(): Partial<Record<PanelId, number>> {
  const raw = readJson(SIZES_KEY)
  const out: Partial<Record<PanelId, number>> = {}
  if (raw && typeof raw === 'object') {
    for (const id of PANEL_IDS) {
      const size = (raw as Record<string, unknown>)[id]
      if (typeof size === 'number' && Number.isFinite(size) && size > 0) out[id] = size
    }
  }
  return out
}

function readRestore(): PanelId[] {
  const raw = readJson(HIDDEN_KEY)
  const ids = Array.isArray(raw) ? PANEL_IDS.filter((id) => raw.includes(id)) : []
  return ids.length ? ids : PANEL_IDS
}

// A panel dragged shut takes the separator's focus with it when the drag ends; this hands focus
// to the panel's toggle then, if the panel is still shut and focus went nowhere.
let pointerDown = false
let afterDrag: (() => void) | null = null
addEventListener(
  'pointerdown',
  () => {
    pointerDown = true
  },
  true,
)
addEventListener('pointerup', () => {
  pointerDown = false
  const run = afterDrag
  afterDrag = null
  if (run) requestAnimationFrame(run)
})
for (const type of ['pointercancel', 'blur'] as const) {
  addEventListener(type, () => {
    pointerDown = false
    afterDrag = null
  })
}

/** Moves focus out of a panel that is closing, to its toggle. */
function rescueFocus(id: PanelId, toggle: HTMLButtonElement | null): void {
  const content = document.querySelector(`[data-panel="${id}"]`)
  if (content?.contains(document.activeElement)) toggle?.focus()
}

export const isMac = navigator.platform.startsWith('Mac')
export const modKey = isMac ? '⌘' : 'Ctrl+'

export interface Panels {
  refs: Record<PanelId, React.RefObject<PanelImperativeHandle | null>>
  toggleRefs: Record<PanelId, React.RefObject<HTMLButtonElement | null>>
  open: Record<PanelId, boolean>
  onResize: (id: PanelId) => (size: PanelSize) => void
  /** Remember these open panels' sizes once a user resize has settled. */
  rememberSizes: (ids: PanelId[]) => void
  toggle: (id: PanelId) => void
  /** Hide every panel but the map, or bring back the ones that were open. */
  toggleMapOnly: () => void
  show: (id: PanelId) => void
}

export function usePanels(): Panels {
  const refs = {
    cameras: usePanelRef(),
    photos: usePanelRef(),
    metadata: usePanelRef(),
  }
  const toggleRefs = {
    cameras: useRef<HTMLButtonElement>(null),
    photos: useRef<HTMLButtonElement>(null),
    metadata: useRef<HTMLButtonElement>(null),
  }
  const [open, setOpen] = useState<Record<PanelId, boolean>>({
    cameras: true,
    photos: true,
    metadata: true,
  })

  const onResize =
    (id: PanelId) =>
    (size: PanelSize): void => {
      const isOpen = size.inPixels > 0
      if (isOpen) afterDrag = null
      else {
        rescueFocus(id, toggleRefs[id].current)
        if (pointerDown) {
          afterDrag = () => {
            const panel = refs[id].current
            if (panel?.isCollapsed() && document.activeElement === document.body) {
              toggleRefs[id].current?.focus()
            }
          }
        }
      }
      setOpen((current) => (current[id] === isOpen ? current : { ...current, [id]: isOpen }))
    }

  const rememberSizes = (ids: PanelId[]): void => {
    const sizes = readSizes()
    for (const id of ids) {
      const panel = refs[id].current
      if (panel && !panel.isCollapsed()) sizes[id] = Math.round(panel.getSize().inPixels)
    }
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes))
  }

  const show = (id: PanelId): void => {
    const panel = refs[id].current
    if (!panel?.isCollapsed()) return
    const saved = readSizes()[id]
    panel.resize(Math.max(saved ?? PANEL_DEFAULT[id], PANEL_MIN[id]))
  }

  const hide = (id: PanelId): void => {
    const panel = refs[id].current
    if (!panel || panel.isCollapsed()) return
    rememberSizes([id])
    rescueFocus(id, toggleRefs[id].current)
    panel.collapse()
  }

  // The panel's own state: React's copy lags a render behind a quick second press.
  const isOpen = (id: PanelId): boolean => refs[id].current?.isCollapsed() === false
  const toggle = (id: PanelId): void => (isOpen(id) ? hide(id) : show(id))

  const toggleMapOnly = (): void => {
    const visible = PANEL_IDS.filter(isOpen)
    if (visible.length > 0) {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(visible))
      for (const id of visible) hide(id)
      return
    }
    for (const id of readRestore()) show(id)
  }

  const actions = useRef({ toggle, toggleMapOnly })
  actions.current = { toggle, toggleMapOnly }

  // The View menu owns the shortcuts (see main/menu.ts).
  useEffect(
    () =>
      window.stecknadel.on('panel', (command) => {
        // A dialog or popover owns the keyboard.
        if (document.querySelector('[role="dialog"]')) return
        if (command === 'map-only') actions.current.toggleMapOnly()
        else actions.current.toggle(command)
      }),
    [],
  )

  return { refs, toggleRefs, open, onResize, rememberSizes, toggle, toggleMapOnly, show }
}
