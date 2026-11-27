import { CameraList, type CameraTimeLabel } from '@renderer/components/CameraList'
import { CameraTimePanel, type CameraTimeStats } from '@renderer/components/CameraTimePanel'
import { MetadataPanel } from '@renderer/components/MetadataPanel'
import { PhotoGrid } from '@renderer/components/PhotoGrid'
import { TrackPanel } from '@renderer/components/TrackPanel'
import { Button } from '@renderer/components/ui/button'
import { ipcErrorMessage } from '@renderer/lib/ipc-error'
import { clearThumbnailCache } from '@renderer/lib/thumbnails'
import { localZone, tzLabel } from '@renderer/lib/time'
import type { DawarichState } from '@shared/ipc'
import type { LibraryProgress, LibrarySnapshot } from '@shared/library'
import { type CameraTimeSettings, defaultCameraSettings } from '@shared/time/cameraSettings'
import { instantSeconds } from '@shared/time/exifDate'
import { type PhotoUtc, photoUtc } from '@shared/time/toUtc'
import {
  defaultFetchRange,
  type FetchRange,
  isOutsideFetchedRange,
  rangeCovering,
} from '@shared/track/range'
import type { TrackSummary } from '@shared/track/types'
import { FolderOpen, TriangleAlert } from 'lucide-react'
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
  // Session only: across trips just the camera's name is remembered (user decision 4).
  const [timeSettings, setTimeSettings] = useState<Record<string, CameraTimeSettings>>({})
  const [fetchRequest, setFetchRequest] = useState<{ range: FetchRange } | null>(null)
  const defaultSettings = useMemo(() => defaultCameraSettings(localZone()), [])

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
  const settingsFor = (key: string): CameraTimeSettings => timeSettings[key] ?? defaultSettings

  const utcs = useMemo(() => {
    const map = new Map<string, PhotoUtc>()
    for (const p of library?.photos ?? []) {
      map.set(p.id, photoUtc(p, timeSettings[p.cameraKey] ?? defaultSettings))
    }
    return map
  }, [library, timeSettings, defaultSettings])

  const cameraStats = useMemo(() => {
    const stats = new Map<string, CameraTimeStats>()
    for (const p of library?.photos ?? []) {
      const s = stats.get(p.cameraKey) ?? { noTime: 0, ambiguous: 0, conflict: 0, recorded: 0 }
      const time = utcs.get(p.id)
      if (!time?.utc) s.noTime++
      if (time?.warnings.includes('ambiguous-local-time')) s.ambiguous++
      if (time?.warnings.includes('offset-conflict')) s.conflict++
      if (p.offsetTimeOriginal) s.recorded++
      stats.set(p.cameraKey, s)
    }
    return stats
  }, [library, utcs])

  const timeLabels = useMemo(() => {
    const labels = new Map<string, CameraTimeLabel>()
    for (const camera of library?.cameras ?? []) {
      const s = timeSettings[camera.key] ?? defaultSettings
      const changes = s.segments.length - 1
      labels.set(camera.key, {
        text: `${tzLabel(s.segments[0].tz)}${changes ? ` + ${changes} change${changes === 1 ? '' : 's'}` : ''}`,
        unconfirmed: !s.confirmed,
      })
    }
    return labels
  }, [library, timeSettings, defaultSettings])

  // Photos whose UTC the fetched Dawarich range can't judge (user decision: never before/after).
  const outside = useMemo(() => {
    if (track?.source.kind !== 'dawarich') return []
    const range = { start: track.source.start, end: track.source.end }
    const out: number[] = []
    for (const time of utcs.values()) {
      if (!time.utc) continue
      const t = instantSeconds(time.utc)
      if (isOutsideFetchedRange(t, range)) out.push(t)
    }
    return out
  }, [track, utcs])

  const selectedCamera = library?.cameras.find((c) => c.key === cameraFilter) ?? null
  const loading = load.status === 'loading'

  return (
    <div className="grid h-full grid-cols-[18rem_1fr_20rem] grid-rows-[1fr_18rem] bg-background text-sm">
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
              timeLabels={timeLabels}
              total={library.photos.length}
              selectedKey={cameraFilter}
              onSelect={setCameraFilter}
              onRename={renameCamera}
            />
            {selectedCamera && (
              <div className="mt-3">
                <CameraTimePanel
                  key={selectedCamera.key}
                  camera={selectedCamera}
                  settings={settingsFor(selectedCamera.key)}
                  stats={
                    cameraStats.get(selectedCamera.key) ?? {
                      noTime: 0,
                      ambiguous: 0,
                      conflict: 0,
                      recorded: 0,
                    }
                  }
                  selectedCaptureTime={
                    selected?.cameraKey === selectedCamera.key ? selected.captureTime : null
                  }
                  onChange={(next) =>
                    setTimeSettings((current) => ({ ...current, [selectedCamera.key]: next }))
                  }
                />
              </div>
            )}
          </div>
        )}
        <div className="mt-auto">
          <TrackPanel
            track={track}
            dawarich={dawarich}
            defaultRange={fetchRange}
            fetchRequest={fetchRequest}
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

      <section aria-label="Photos" className="flex min-h-0 flex-col border-t" aria-busy={loading}>
        {outside.length > 0 && track?.source.kind === 'dawarich' && load.status !== 'loading' && (
          <div
            role="status"
            data-testid="outside-range"
            className="flex shrink-0 items-center gap-2 border-b bg-amber-50 px-4 py-1.5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <TriangleAlert className="size-4 shrink-0" />
            <span className="flex-1">
              The track doesn’t cover {outside.length.toLocaleString()}{' '}
              {outside.length === 1 ? 'photo' : 'photos'}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => {
                const source = track.source as { start: string; end: string }
                setFetchRequest({
                  range: rangeCovering(outside, { start: source.start, end: source.end }),
                })
              }}
            >
              Fetch again…
            </Button>
          </div>
        )}
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
          <div className="min-h-0 flex-1">
            <PhotoGrid
              photos={photos}
              cameraNames={cameraNames}
              utcs={utcs}
              showCamera={cameraFilter === null && library.cameras.length > 1}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
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
