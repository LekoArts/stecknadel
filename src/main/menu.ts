import type { PanelCommand } from '@shared/ipc'
import { Menu, type MenuItemConstructorOptions } from 'electron'

const PANEL_ITEMS: { id: PanelCommand; label: string; accelerator: string }[] = [
  { id: 'cameras', label: 'Cameras', accelerator: 'CmdOrCtrl+1' },
  { id: 'photos', label: 'Photos', accelerator: 'CmdOrCtrl+2' },
  { id: 'metadata', label: 'Metadata', accelerator: 'CmdOrCtrl+3' },
  { id: 'map-only', label: 'Map Only', accelerator: 'CmdOrCtrl+0' },
]

/**
 * The app menu. Panel shortcuts live here, not in the page: a menu accelerator wins over the
 * page's keydown, and the default menu's Cmd/Ctrl+0 (reset zoom) would take Map Only.
 */
export function installMenu(onPanel: (command: PanelCommand) => void): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as const] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...PANEL_ITEMS.map(
          (item): MenuItemConstructorOptions => ({
            id: `panel-${item.id}`,
            label: item.label,
            accelerator: item.accelerator,
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
