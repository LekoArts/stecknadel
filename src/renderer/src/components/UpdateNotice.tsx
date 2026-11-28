import type { UpdateState } from '@shared/ipc'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './ui/button'

/** A newer version: a link to the release, or (NSIS installs) a restart into the downloaded one. */
export function UpdateNotice(): React.JSX.Element | null {
  const [update, setUpdate] = useState<UpdateState>({ kind: 'none' })
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void window.stecknadel.getUpdate().then((state) => {
      if (current) setUpdate((seen) => (seen.kind === 'none' ? state : seen))
    })
    const off = window.stecknadel.on('update', setUpdate)
    return () => {
      current = false
      off()
    }
  }, [])

  if (update.kind === 'none' || dismissed === `${update.kind}:${update.version}`) return null
  return (
    <div
      role="status"
      data-testid="update-notice"
      className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border bg-popover py-2 pr-2 pl-4 text-popover-foreground text-sm shadow-lg"
    >
      <span>
        {update.kind === 'ready'
          ? `Stecknadel ${update.version} is ready`
          : `Stecknadel ${update.version} is available`}
      </span>
      {update.kind === 'ready' ? (
        <Button size="sm" onClick={() => void window.stecknadel.installUpdate()}>
          Restart to install
        </Button>
      ) : (
        <Button size="sm" asChild>
          <a href={update.url} target="_blank" rel="noreferrer">
            Download
          </a>
        </Button>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Dismiss"
        onClick={() => setDismissed(`${update.kind}:${update.version}`)}
      >
        <X />
      </Button>
    </div>
  )
}
