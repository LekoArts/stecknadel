import { useCallback, useEffect, useRef, useState } from 'react'
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

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
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
  const openRef = useRef(open)
  openRef.current = open

  const onResize = useCallback(
    (id: PanelId) => (size: PanelSize) => {
      const isOpen = size.inPixels > 0
      setOpen((current) => (current[id] === isOpen ? current : { ...current, [id]: isOpen }))
    },
    [],
  )

  const rememberSizes = (ids: PanelId[]): void => {
    const sizes = readJson<Partial<Record<PanelId, number>>>(SIZES_KEY, {})
    for (const id of ids) {
      const panel = refs[id].current
      if (panel && !panel.isCollapsed()) sizes[id] = Math.round(panel.getSize().inPixels)
    }
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes))
  }

  const show = (id: PanelId): void => {
    const panel = refs[id].current
    if (!panel?.isCollapsed()) return
    const saved = readJson<Partial<Record<PanelId, number>>>(SIZES_KEY, {})[id]
    panel.resize(Math.max(saved ?? PANEL_DEFAULT[id], PANEL_MIN[id]))
  }

  const hide = (id: PanelId): void => {
    const panel = refs[id].current
    if (!panel || panel.isCollapsed()) return
    rememberSizes([id])
    // Don't leave focus on a control that is about to disappear.
    const content = document.querySelector(`[data-panel="${id}"]`)
    if (content?.contains(document.activeElement)) toggleRefs[id].current?.focus()
    panel.collapse()
  }

  const toggle = (id: PanelId): void => (openRef.current[id] ? hide(id) : show(id))

  const toggleMapOnly = (): void => {
    const visible = PANEL_IDS.filter((id) => openRef.current[id])
    if (visible.length > 0) {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(visible))
      for (const id of visible) hide(id)
      return
    }
    const restore = readJson<PanelId[]>(HIDDEN_KEY, PANEL_IDS).filter((id) =>
      PANEL_IDS.includes(id),
    )
    for (const id of restore.length ? restore : PANEL_IDS) show(id)
  }

  const actions = useRef({ toggle, toggleMapOnly })
  actions.current = { toggle, toggleMapOnly }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(isMac ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey) return
      // A dialog or popover owns the keyboard.
      if (document.querySelector('[role="dialog"]')) return
      const id = PANEL_IDS.find((p) => PANEL_KEY[p] === e.key)
      if (id) actions.current.toggle(id)
      else if (e.key === '0') actions.current.toggleMapOnly()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { refs, toggleRefs, open, onResize, rememberSizes, toggle, toggleMapOnly, show }
}
