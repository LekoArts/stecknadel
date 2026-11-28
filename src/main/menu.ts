import type { PanelCommand } from '@shared/ipc'
import { Menu, type MenuItemConstructorOptions } from 'electron'

const PANEL_ITEMS: { id: PanelCommand; label: string; accelerator: string }[] = [
  { id: 'cameras', label: 'Cameras', accelerator: 'CmdOrCtrl+1' },
  { id: 'photos', label: 'Photos', accelerator: 'CmdOrCtrl+2' },
  { id: 'metadata', label: 'Metadata', accelerator: 'CmdOrCtrl+3' },
  { id: 'map-only', label: 'Map Only', accelerator: 'CmdOrCtrl+0' },
]

/** The panel command a key press asks for, if any. Held keys repeat: the caller swallows those. */
export function panelShortcut(input: Electron.Input): PanelCommand | null {
  if (input.type !== 'keyDown' || input.isComposing || input.alt || input.shift) return null
  const mod = process.platform === 'darwin' ? input.meta && !input.control : input.control
  if (!mod) return null
  return PANEL_ITEMS.find((item) => item.accelerator.endsWith(`+${input.key}`))?.id ?? null
}

/**
 * The app menu. Main handles the panel keys before the page sees them (see panelShortcut);
 * preventing that input also keeps the menu from acting on it, so the menu only shows the keys.
 * The default menu's Cmd/Ctrl+0 (reset zoom) moves to Shift+0.
 */
export function installMenu(
  onPanel: (command: PanelCommand) => void,
  onSettings: () => void,
): void {
  const isMac = process.platform === 'darwin'
  const settings: MenuItemConstructorOptions = {
    id: 'settings',
    // macOS convention: an item that opens a window ends in an ellipsis.
    label: isMac ? 'Settings…' : 'Settings',
    accelerator: 'CmdOrCtrl+,',
    click: onSettings,
  }
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            role: 'appMenu',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settings,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    isMac
      ? { role: 'fileMenu' }
      : { role: 'fileMenu', submenu: [settings, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...PANEL_ITEMS.map(
          (item): MenuItemConstructorOptions => ({
            id: `panel-${item.id}`,
            label: item.label,
            accelerator: item.accelerator,
            registerAccelerator: false,
            click: () => onPanel(item.id),
          }),
        ),
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom', accelerator: 'CmdOrCtrl+Shift+0' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
