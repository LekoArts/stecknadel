import { CameraList } from '@renderer/components/CameraList'
import { MetadataPanel } from '@renderer/components/MetadataPanel'
import { PhotoGrid } from '@renderer/components/PhotoGrid'
import { TrackPanel } from '@renderer/components/TrackPanel'
import { Button } from '@renderer/components/ui/button'
import { ipcErrorMessage } from '@renderer/lib/ipc-error'
import { clearThumbnailCache } from '@renderer/lib/thumbnails'
import type { DawarichState } from '@shared/ipc'
import type { LibraryProgress, LibrarySnapshot } from '@shared/library'
import { defaultFetchRange } from '@shared/track/range'
import type { TrackSummary } from '@shared/track/types'
import { FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type Load =
  | { status: 'idle' }
  | { status: 'loading'; progress: LibraryProgress | null }
  | { status: 'error'; message: string }

export default function App(): React.JSX.Element {
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null)
  const [load, setLoad] = useState<Load>({ status: 'idle' })
  const [cameraFilter, setCameraFilter] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [track, setTrack] = useState<TrackSummary | null>(null)
  const [dawarich, setDawarich] = useState<DawarichState | null>(null)

  useEffect(() => {
    void window.stecknadel.getTrackState().then((state) => {
      setTrack(state.track)
      setDawarich(state.dawarich)
    })
  }, [])

  useEffect(
    () =>
      window.stecknadel.on('libraryProgress', (progress) =>
        setLoad((current) =>
          current.status === 'loading' ? { status: 'loading', progress } : current,
        ),
      ),
    [],
  )

  const openFolder = async (): Promise<void> => {
    setLoad({ status: 'loading', progress: null })
    try {
      const snapshot = await window.stecknadel.openFolder()
      if (snapshot) {
        clearThumbnailCache()
        setLibrary(snapshot)
        setCameraFilter(null)
        setSelectedId(null)
      }
      setLoad({ status: 'idle' })
    } catch (error) {
      setLoad({ status: 'error', message: ipcErrorMessage(error) })
    }
  }

  const renameCamera = async (key: string, name: string): Promise<void> => {
    const cameras = await window.stecknadel.renameCamera({ key, name })
    setLibrary((current) => (current ? { ...current, cameras } : current))
  }

  const cameraNames = useMemo(
    () => new Map(library?.cameras.map((c) => [c.key, c.name]) ?? []),
    [library],
  )
  const photos = useMemo(
    () =>
      library?.photos.filter((p) => cameraFilter === null || p.cameraKey === cameraFilter) ?? [],
    [library, cameraFilter],
  )
  const selected = useMemo(
    () => library?.photos.find((p) => p.id === selectedId) ?? null,
    [library, selectedId],
  )
  const fetchRange = useMemo(
    () => (library ? defaultFetchRange(library.photos.map((p) => p.captureTime)) : null),
    [library],
  )
  const loading = load.status === 'loading'

  return (
    <div className="grid h-full grid-cols-[16rem_1fr_20rem] grid-rows-[1fr_18rem] bg-background text-sm">
      <aside
        aria-label="Cameras"
        className="row-span-2 flex min-h-0 flex-col border-r bg-sidebar text-sidebar-foreground"
      >
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <h2 className="flex-1 truncate font-medium" title={library?.folderName}>
            {library?.folderName ?? 'Cameras'}
          </h2>
          <Button size="sm" variant="outline" onClick={() => void openFolder()} disabled={loading}>
            <FolderOpen />
            {library ? 'Open…' : 'Open folder'}
          </Button>
        </div>
        {library && (
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            <CameraList
              cameras={library.cameras}
              total={library.photos.length}
              selectedKey={cameraFilter}
              onSelect={setCameraFilter}
              onRename={renameCamera}
            />
          </div>
        )}
        <div className="mt-auto">
          <TrackPanel
            track={track}
            dawarich={dawarich}
            defaultRange={fetchRange}
            onTrack={setTrack}
            onDawarich={setDawarich}
          />
        </div>
      </aside>

      <main aria-label="Map" className="flex items-center justify-center bg-muted/40">
        <div className="text-center">
          <h1 className="font-semibold text-2xl tracking-tight">Stecknadel</h1>
          <p className="mt-1 text-muted-foreground">
            Load a folder of photos and a track to see where each photo was taken.
          </p>
        </div>
      </main>

      <aside aria-label="Metadata" className="row-span-2 min-h-0 border-l">
        <MetadataPanel photo={selected} />
      </aside>

      <section aria-label="Photos" className="min-h-0 border-t" aria-busy={loading}>
        {load.status === 'loading' && load.progress ? (
          // While the folder dialog is open there is no progress yet: keep showing the current library.
          <LoadingState progress={load.progress} />
        ) : load.status === 'error' ? (
          <p className="px-4 py-3 text-destructive">Couldn’t open the folder: {load.message}</p>
        ) : !library ? null : library.photos.length === 0 ? (
          <p className="px-4 py-3 text-muted-foreground">
            No JPEG, HEIC or RAW photos in {library.folderName}.
          </p>
        ) : (
          <PhotoGrid
            photos={photos}
            cameraNames={cameraNames}
            showCamera={cameraFilter === null && library.cameras.length > 1}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </section>
    </div>
  )
}

function LoadingState({ progress }: { progress: LibraryProgress }): React.JSX.Element {
  const reading = progress.phase === 'reading' && progress.total > 0
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <p data-testid="library-progress" className="tabular-nums">
        {reading
          ? `Reading ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} photos`
          : `Finding photos${progress.done ? ` · ${progress.done.toLocaleString()}` : ''}`}
      </p>
      <div className="h-1 w-64 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-150 motion-reduce:transition-none"
          style={{ width: reading ? `${(progress.done / progress.total) * 100}%` : '0%' }}
        />
      </div>
    </div>
  )
}
