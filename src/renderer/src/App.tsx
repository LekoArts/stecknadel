import { CameraList, type CameraTimeLabel } from '@renderer/components/CameraList'
import {
  allRecorded,
  CameraTimePanel,
  type CameraTimeStats,
  type TimeOrigin,
} from '@renderer/components/CameraTimePanel'
import { MapPanel } from '@renderer/components/MapPanel'
import { MetadataPanel } from '@renderer/components/MetadataPanel'
import { PanelToggles } from '@renderer/components/PanelToggles'
import { PhotoGrid } from '@renderer/components/PhotoGrid'
import { PhotoList } from '@renderer/components/PhotoList'
import { PhotosToolbar, type PhotoView } from '@renderer/components/PhotosToolbar'
import { SettingsDialog } from '@renderer/components/SettingsDialog'
import { TrackPanel } from '@renderer/components/TrackPanel'
import { Button } from '@renderer/components/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable'
import { ipcErrorMessage } from '@renderer/lib/ipc-error'
import { PANEL_DEFAULT, PANEL_MIN, usePanels } from '@renderer/lib/panels'
import {
  inGroup,
  type Sort,
  STATUS_GROUPS,
  type StatusGroup,
  sortPhotos,
} from '@renderer/lib/photoFilter'
import { usePreview } from '@renderer/lib/preview'
import { clearThumbnailCache } from '@renderer/lib/thumbnails'
import { localZone, offsetLabel, tzLabel } from '@renderer/lib/time'
import type { DawarichState } from '@shared/ipc'
import type { LibraryProgress, LibrarySnapshot, PhotoSummary } from '@shared/library'
import { STATUS_LABELS } from '@shared/match/status'
import type { Position, TrackGeometry } from '@shared/preview'
import type { SettingsView } from '@shared/settings'
import { applyOffsetCandidate } from '@shared/time/applyOffset'
import {
  type CameraTimeSettings,
  copyZones,
  defaultCameraSettings,
} from '@shared/time/cameraSettings'
import { detectCameraSettings } from '@shared/time/detectZones'
import { instantSeconds } from '@shared/time/exifDate'
import type { OffsetCandidate } from '@shared/time/offsetFinder'
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
import { useDefaultLayout } from 'react-resizable-panels'

/** The map and its overlays need this much room; it never collapses, so the panel toggles stay reachable. */
const CENTER_MIN_WIDTH = 360
const MAP_MIN_HEIGHT = 200
const VIEW_KEY = 'stecknadel.photoView.v1'

type Load =
  | { status: 'idle' }
  | { status: 'loading'; progress: LibraryProgress | null }
  | { status: 'error'; message: string }

export default function App(): React.JSX.Element {
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null)
  const [load, setLoad] = useState<Load>({ status: 'idle' })
  const [cameraFilter, setCameraFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusGroup | null>(null)
  const [view, setView] = useState<PhotoView>(() =>
    localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid',
  )
  const [sort, setSort] = useState<Sort | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [track, setTrack] = useState<TrackSummary | null>(null)
  const [dawarich, setDawarich] = useState<DawarichState | null>(null)
  // Session only: across trips just the camera's name is remembered (user decision 4).
  const [timeSettings, setTimeSettings] = useState<Record<string, CameraTimeSettings>>({})
  const [fetchRequest, setFetchRequest] = useState<{ range: FetchRange } | null>(null)
  const [manual, setManual] = useState<Record<string, Position>>({})
  const [geometry, setGeometry] = useState<TrackGeometry | null>(null)
  /** The zone at each track point, for detecting camera zones; null until looked up. */
  const [trackZones, setTrackZones] = useState<(string | null)[] | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [mapRevision, setMapRevision] = useState(0)
  const settingsKey = settings ? JSON.stringify([settings.matching, settings.writing]) : null
  const matchingKey = settings ? JSON.stringify(settings.matching) : null
  const defaultSettings = useMemo(() => defaultCameraSettings(localZone()), [])
  // Settings from the track for each camera the user hasn't set: the clock showed local time.
  const detected = useMemo(() => {
    const out = new Map<string, CameraTimeSettings>()
    if (!library || !geometry || !trackZones || trackZones.length !== geometry.points.length) {
      return out
    }
    const zoned = { points: geometry.points, zones: trackZones }
    const byCamera = Map.groupBy(library.photos, (p) => p.cameraKey)
    for (const [key, photos] of byCamera) {
      const found = detectCameraSettings(photos, zoned, true)
      if (found) out.set(key, found)
    }
    return out
  }, [library, geometry, trackZones])
  const tripZones = useMemo(
    () => [...new Set(trackZones?.filter((z): z is string => z !== null))],
    [trackZones],
  )
  // Every camera's settings, defaults included: what the preview (and later the write) uses.
  const cameraSettings = useMemo(() => {
    const out: Record<string, CameraTimeSettings> = {}
    for (const c of library?.cameras ?? []) {
      out[c.key] = timeSettings[c.key] ?? detected.get(c.key) ?? defaultSettings
    }
    return out
  }, [library, timeSettings, detected, defaultSettings])
  const originOf = (key: string): TimeOrigin =>
    timeSettings[key] ? 'user' : detected.has(key) ? 'track' : 'default'
  const preview = usePreview(library, track, cameraSettings, manual, settingsKey)

  // Bridged stays depend on the matching settings too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: matchingKey is a refetch trigger
  useEffect(() => {
    if (!track) {
      setGeometry(null)
      return
    }
    let current = true
    void window.stecknadel.getTrackGeometry().then((g) => {
      if (current) setGeometry(g)
    })
    return () => {
      current = false
    }
  }, [track, matchingKey])

  useEffect(() => {
    setTrackZones(null)
    if (!track) return
    let current = true
    void window.stecknadel.getTrackZones().then((zones) => {
      if (current) setTrackZones(zones)
    })
    return () => {
      current = false
    }
  }, [track])

  useEffect(() => {
    void window.stecknadel.getTrackState().then((state) => {
      setTrack(state.track)
      setDawarich(state.dawarich)
    })
    void window.stecknadel.getSettings().then(setSettings)
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
        setManual({})
        setCameraFilter(null)
        setStatusFilter(null)
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
  const cameraPhotos = useMemo(
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
  const settingsFor = (key: string): CameraTimeSettings => cameraSettings[key] ?? defaultSettings

  const utcs = useMemo(() => {
    const map = new Map<string, PhotoUtc>()
    for (const p of library?.photos ?? []) {
      map.set(p.id, photoUtc(p, cameraSettings[p.cameraKey] ?? defaultSettings))
    }
    return map
  }, [library, cameraSettings, defaultSettings])

  const cameraStats = useMemo(() => {
    const stats = new Map<string, CameraTimeStats>()
    for (const p of library?.photos ?? []) {
      const s = stats.get(p.cameraKey) ?? {
        noTime: 0,
        ambiguous: 0,
        conflict: 0,
        recorded: 0,
        offsets: [],
        first: null,
      }
      const time = utcs.get(p.id)
      if (!time?.utc) s.noTime++
      if (time?.warnings.includes('ambiguous-local-time')) s.ambiguous++
      if (time?.warnings.includes('offset-conflict')) s.conflict++
      if (p.offsetTimeOriginal) {
        s.recorded++
        if (!s.offsets.includes(p.offsetTimeOriginal)) s.offsets.push(p.offsetTimeOriginal)
      }
      // EXIF date strings sort chronologically.
      if (p.captureTime && (s.first === null || p.captureTime < s.first)) s.first = p.captureTime
      stats.set(p.cameraKey, s)
    }
    for (const s of stats.values()) s.offsets.sort()
    return stats
  }, [library, utcs])

  const timeLabels = useMemo(() => {
    const labels = new Map<string, CameraTimeLabel>()
    for (const camera of library?.cameras ?? []) {
      const s = cameraSettings[camera.key]
      const stats = cameraStats.get(camera.key)
      if (stats && allRecorded(s, stats, camera.count)) {
        labels.set(camera.key, {
          text: `Saved in photos: ${stats.offsets.map(offsetLabel).join(', ')}`,
          unconfirmed: false,
          fromPhotos: true,
        })
        continue
      }
      const changes = s.segments.length - 1
      labels.set(camera.key, {
        text: `${tzLabel(s.segments[0].tz)}${changes ? ` + ${changes} change${changes === 1 ? '' : 's'}` : ''}`,
        unconfirmed: !s.confirmed,
        fromPhotos: false,
      })
    }
    return labels
  }, [library, cameraSettings, cameraStats])

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

  const statuses = useMemo(
    () => new Map(preview.snapshot?.results.map((r) => [r.id, r.status]) ?? []),
    [preview.snapshot],
  )
  const groupCounts = useMemo(() => {
    if (!preview.snapshot) return null
    const counts: Record<StatusGroup, number> = { attention: 0, placed: 0, 'has-gps': 0 }
    for (const p of cameraPhotos) {
      for (const g of STATUS_GROUPS) {
        if (inGroup(g, statuses.get(p.id), utcs.get(p.id))) counts[g]++
      }
    }
    return counts
  }, [preview.snapshot, cameraPhotos, statuses, utcs])
  // Without a preview there are no statuses to filter by.
  const activeStatusFilter = groupCounts ? statusFilter : null
  const photos = useMemo(() => {
    const filtered =
      activeStatusFilter === null
        ? cameraPhotos
        : cameraPhotos.filter((p) =>
            inGroup(activeStatusFilter, statuses.get(p.id), utcs.get(p.id)),
          )
    return view === 'list'
      ? sortPhotos(filtered, sort, {
          cameraNames,
          utcs,
          statuses,
          statusLabel: (s) => STATUS_LABELS[s.kind],
        })
      : filtered
  }, [cameraPhotos, activeStatusFilter, statuses, utcs, view, sort, cameraNames])

  /** Selecting from the map: a status filter that hides the photo gets out of the way. */
  const selectFromMap = (id: string | null): void => {
    if (id && activeStatusFilter && !inGroup(activeStatusFilter, statuses.get(id), utcs.get(id))) {
      setStatusFilter(null)
    }
    setSelectedId(id)
  }

  const applyOffset = (photo: PhotoSummary, candidate: OffsetCandidate): void => {
    const time = utcs.get(photo.id)
    if (!time?.wall) return
    const settings = settingsFor(photo.cameraKey)
    setTimeSettings((current) => ({
      ...current,
      [photo.cameraKey]: applyOffsetCandidate(settings, time, photo.offsetTimeOriginal, candidate),
    }))
  }

  const setPlacement = (id: string, position: Position | null): void =>
    setManual((current) => {
      const next = { ...current }
      if (position) next[id] = position
      else delete next[id]
      return next
    })

  const panels = usePanels()
  const outerLayout = useDefaultLayout({ id: 'stecknadel.layout.v1.outer', storage: localStorage })
  const centerLayout = useDefaultLayout({
    id: 'stecknadel.layout.v1.center',
    storage: localStorage,
  })

  const selectedCamera = library?.cameras.find((c) => c.key === cameraFilter) ?? null
  const loading = load.status === 'loading'

  return (
    <ResizablePanelGroup
      id="outer"
      orientation="horizontal"
      className="bg-background text-sm"
      defaultLayout={outerLayout.defaultLayout}
      onLayoutChanged={(layout, meta) => {
        outerLayout.onLayoutChanged(layout, meta)
        if (meta.isUserInteraction) panels.rememberSizes(['cameras', 'metadata'])
      }}
    >
      <ResizablePanel
        id="cameras"
        panelRef={panels.refs.cameras}
        collapsible
        minSize={PANEL_MIN.cameras}
        defaultSize={PANEL_DEFAULT.cameras}
        groupResizeBehavior="preserve-pixel-size"
        onResize={panels.onResize('cameras')}
      >
        <aside
          aria-label="Cameras"
          data-panel="cameras"
          // Collapsed, it keeps its state (an open Dawarich fetch) but leaves the tab order.
          inert={!panels.open.cameras}
          className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
        >
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <h2 className="flex-1 truncate font-medium" title={library?.folderName}>
              {library?.folderName ?? 'Cameras'}
            </h2>
            {library ? (
              // The folder name says what's open; the icon is enough to open another.
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Open folder"
                title="Open folder"
                onClick={() => void openFolder()}
                disabled={loading}
              >
                <FolderOpen />
              </Button>
            ) : (
              <Button size="sm" onClick={() => void openFolder()} disabled={loading}>
                <FolderOpen />
                Open folder
              </Button>
            )}
            {settings && (
              <SettingsDialog
                settings={settings}
                onSaved={setSettings}
                onPmtilesChosen={(next) => {
                  setSettings(next)
                  setMapRevision((r) => r + 1)
                }}
              />
            )}
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
                    origin={originOf(selectedCamera.key)}
                    tripZones={tripZones}
                    copySources={library.cameras
                      .filter((c) => {
                        const stats = cameraStats.get(c.key)
                        return (
                          c.key !== selectedCamera.key &&
                          originOf(c.key) !== 'default' &&
                          !(stats && allRecorded(settingsFor(c.key), stats, c.count))
                        )
                      })
                      .map((c) => ({
                        key: c.key,
                        name: c.name,
                        label: timeLabels.get(c.key)?.text ?? '',
                      }))}
                    onCopyFrom={(key) =>
                      setTimeSettings((current) => ({
                        ...current,
                        [selectedCamera.key]: copyZones(
                          settingsFor(selectedCamera.key),
                          settingsFor(key),
                        ),
                      }))
                    }
                    stats={
                      cameraStats.get(selectedCamera.key) ?? {
                        noTime: 0,
                        ambiguous: 0,
                        conflict: 0,
                        recorded: 0,
                        offsets: [],
                        first: null,
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
      </ResizablePanel>
      <ResizableHandle />

      <ResizablePanel id="center" minSize={CENTER_MIN_WIDTH}>
        <ResizablePanelGroup
          id="center-split"
          orientation="vertical"
          defaultLayout={centerLayout.defaultLayout}
          onLayoutChanged={(layout, meta) => {
            centerLayout.onLayoutChanged(layout, meta)
            if (meta.isUserInteraction) panels.rememberSizes(['photos'])
          }}
        >
          <ResizablePanel id="map" minSize={MAP_MIN_HEIGHT}>
            <main aria-label="Map" className="relative h-full min-h-0 bg-muted/40">
              <MapPanel
                mapSource={settings?.mapSource ?? null}
                mapRevision={mapRevision}
                library={library}
                hasTrack={!!track && track.count > 0}
                geometry={geometry}
                preview={preview}
                utcs={utcs}
                selectedId={selectedId}
                onSelect={selectFromMap}
                onApplyOffset={applyOffset}
                onManual={setPlacement}
              />
              <PanelToggles panels={panels} />
            </main>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel
            id="photos"
            panelRef={panels.refs.photos}
            collapsible
            minSize={PANEL_MIN.photos}
            defaultSize={PANEL_DEFAULT.photos}
            groupResizeBehavior="preserve-pixel-size"
            onResize={panels.onResize('photos')}
          >
            {panels.open.photos && (
              <section
                aria-label="Photos"
                data-panel="photos"
                className="flex h-full min-h-0 flex-col"
                aria-busy={loading}
              >
                {outside.length > 0 &&
                  track?.source.kind === 'dawarich' &&
                  load.status !== 'loading' && (
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
                          panels.show('cameras')
                          setFetchRequest({
                            range: rangeCovering(outside, { start: source.start, end: source.end }),
                          })
                        }}
                      >
                        Fetch wider range
                      </Button>
                    </div>
                  )}
                {load.status === 'loading' && load.progress ? (
                  // While the folder dialog is open there is no progress yet: keep showing the current library.
                  <LoadingState progress={load.progress} />
                ) : load.status === 'error' ? (
                  <p className="px-4 py-3 text-destructive">
                    Couldn’t open the folder: {load.message}
                  </p>
                ) : !library ? null : library.photos.length === 0 ? (
                  <p className="px-4 py-3 text-muted-foreground">
                    No JPEG, HEIC or RAW photos in {library.folderName}.
                  </p>
                ) : (
                  <>
                    <PhotosToolbar
                      view={view}
                      onView={(next) => {
                        setView(next)
                        localStorage.setItem(VIEW_KEY, next)
                      }}
                      cameras={library.cameras}
                      cameraFilter={cameraFilter}
                      onCameraFilter={setCameraFilter}
                      groupCounts={groupCounts}
                      total={cameraPhotos.length}
                      statusFilter={activeStatusFilter}
                      onStatusFilter={setStatusFilter}
                    />
                    <div className="min-h-0 flex-1">
                      {photos.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                          <p>No photos match</p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setStatusFilter(null)
                              setCameraFilter(null)
                            }}
                          >
                            Clear filters
                          </Button>
                        </div>
                      ) : view === 'list' ? (
                        <PhotoList
                          photos={photos}
                          cameraNames={cameraNames}
                          utcs={utcs}
                          statuses={statuses}
                          showCamera={cameraFilter === null && library.cameras.length > 1}
                          sort={sort}
                          onSort={setSort}
                          selectedId={selectedId}
                          onSelect={setSelectedId}
                        />
                      ) : (
                        <PhotoGrid
                          photos={photos}
                          cameraNames={cameraNames}
                          utcs={utcs}
                          statuses={statuses}
                          showCamera={cameraFilter === null && library.cameras.length > 1}
                          selectedId={selectedId}
                          onSelect={setSelectedId}
                        />
                      )}
                    </div>
                  </>
                )}
              </section>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel
        id="metadata"
        panelRef={panels.refs.metadata}
        collapsible
        minSize={PANEL_MIN.metadata}
        defaultSize={PANEL_DEFAULT.metadata}
        groupResizeBehavior="preserve-pixel-size"
        onResize={panels.onResize('metadata')}
      >
        {panels.open.metadata && (
          <aside aria-label="Metadata" data-panel="metadata" className="h-full min-h-0">
            <MetadataPanel photo={selected} />
          </aside>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
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
          className="h-full origin-left bg-primary transition-transform duration-150 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${reading ? progress.done / progress.total : 0})` }}
        />
      </div>
    </div>
  )
}
