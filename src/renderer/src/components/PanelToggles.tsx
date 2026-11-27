import { Button } from '@renderer/components/ui/button'
import { modKey, PANEL_KEY, PANEL_LABEL, type PanelId, type Panels } from '@renderer/lib/panels'
import { Maximize2, PanelBottom, PanelLeft, PanelRight } from 'lucide-react'

const ICONS: Record<PanelId, typeof PanelLeft> = {
  cameras: PanelLeft,
  photos: PanelBottom,
  metadata: PanelRight,
}

export function PanelToggles({ panels }: { panels: Panels }): React.JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label="Panels"
      className="absolute top-3 right-3 z-10 flex gap-0.5 rounded-lg border bg-background/95 p-0.5 shadow-sm"
    >
      {(['cameras', 'photos', 'metadata'] as const).map((id) => {
        const Icon = ICONS[id]
        const shortcut = `${modKey}${PANEL_KEY[id]}`
        return (
          <Button
            key={id}
            ref={panels.toggleRefs[id]}
            size="icon-sm"
            variant="ghost"
            aria-label={PANEL_LABEL[id]}
            aria-pressed={panels.open[id]}
            aria-keyshortcuts={`${modKey === '⌘' ? 'Meta' : 'Control'}+${PANEL_KEY[id]}`}
            title={`${panels.open[id] ? 'Hide' : 'Show'} ${PANEL_LABEL[id].toLowerCase()} (${shortcut})`}
            className="text-muted-foreground aria-pressed:text-foreground"
            onClick={() => panels.toggle(id)}
          >
            <Icon />
          </Button>
        )
      })}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Map only"
        aria-pressed={!Object.values(panels.open).some(Boolean)}
        aria-keyshortcuts={`${modKey === '⌘' ? 'Meta' : 'Control'}+0`}
        title={`${Object.values(panels.open).some(Boolean) ? 'Map only' : 'Show panels again'} (${modKey}0)`}
        className="text-muted-foreground aria-pressed:text-foreground"
        onClick={panels.toggleMapOnly}
      >
        <Maximize2 />
      </Button>
    </div>
  )
}
