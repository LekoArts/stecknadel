import 'maplibre-gl/dist/maplibre-gl.css'
import { STATUS_COLORS } from '@renderer/lib/status'
import type { MatchKind } from '@shared/match/status'
import type { TrackGeometry } from '@shared/preview'
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { type ReactNode, useEffect, useRef, useState } from 'react'

maplibregl.setWorkerUrl(workerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
/** Used when the map style can't be loaded (offline): track and pins still show. */
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f4f4f5' } }],
}
const TWEEN_MS = 250

export interface MapPin {
  id: string
  lat: number
  lon: number
  kind: MatchKind
}

interface MapViewProps {
  geometry: TrackGeometry | null
  pins: MapPin[]
  selectedId: string | null
  /**
   * `find-offset` / `place`: a click anywhere is reported to `onMapClick`.
   * `copy`: pins stay clickable (to pick the photo to copy from).
   */
  clickMode: ClickMode
  onPinClick: (id: string) => void
  onMapClick: (at: { lat: number; lon: number }) => void
  renderHover: (id: string) => ReactNode
  children?: ReactNode
}

export type ClickMode = 'find-offset' | 'place' | 'copy' | null
type Coords = [number, number]
type Data = Parameters<GeoJSONSource['setData']>[0]

const reduceMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Track lines: runs of points ExifTool interpolates; bridged stays separately (dashed). */
function trackFeatures(geometry: TrackGeometry | null): Data {
  if (!geometry) return { type: 'FeatureCollection', features: [] }
  const { points, intervals, geoMaxIntSecs } = geometry
  const runs: Coords[][] = []
  let run: Coords[] = []
  const stays: Coords[][] = []
  const bridged = new Set(intervals.map((i) => i.from))
  points.forEach(([t, lat, lon], i) => {
    const prev = points[i - 1]
    if (prev && t - prev[0] > geoMaxIntSecs) {
      if (bridged.has(prev[0]))
        stays.push([
          [prev[2], prev[1]],
          [lon, lat],
        ])
      if (run.length > 1) runs.push(run)
      run = []
    }
    run.push([lon, lat])
  })
  if (run.length > 1) runs.push(run)
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'track' },
        geometry: { type: 'MultiLineString', coordinates: runs },
      },
      {
        type: 'Feature',
        properties: { kind: 'stay' },
        geometry: { type: 'MultiLineString', coordinates: stays },
      },
    ],
  }
}

function pinFeatures(pins: MapPin[], coords: Map<string, Coords>, selectedId: string | null): Data {
  return {
    type: 'FeatureCollection',
    features: pins.map((pin) => ({
      type: 'Feature',
      properties: { id: pin.id, color: STATUS_COLORS[pin.kind], selected: pin.id === selectedId },
      geometry: { type: 'Point', coordinates: coords.get(pin.id) ?? [pin.lon, pin.lat] },
    })),
  }
}

function addLayers(map: maplibregl.Map): void {
  if (map.getSource('track')) return
  map.addSource('track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addSource('pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'track-line',
    type: 'line',
    source: 'track',
    filter: ['==', ['get', 'kind'], 'track'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#7c3aed', 'line-width': 3, 'line-opacity': 0.75 },
  })
  map.addLayer({
    id: 'track-stay',
    type: 'line',
    source: 'track',
    filter: ['==', ['get', 'kind'], 'stay'],
    paint: { 'line-color': '#7c3aed', 'line-width': 3, 'line-dasharray': [1, 1.5] },
  })
  map.addLayer({
    id: 'pins',
    type: 'circle',
    source: 'pins',
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['case', ['get', 'selected'], 9, 6],
      'circle-stroke-color': ['case', ['get', 'selected'], '#111827', '#ffffff'],
      'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.5],
    },
  })
}

export function MapView({
  geometry,
  pins,
  selectedId,
  clickMode,
  onPinClick,
  onMapClick,
  renderHover,
  children,
}: MapViewProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // Bumped on every (re)loaded style: sources and layers are new then.
  const [styleVersion, setStyleVersion] = useState(0)
  const ready = styleVersion > 0
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  // Where each pin is drawn right now (mid-tween positions included).
  const drawn = useRef(new Map<string, Coords>())
  const frame = useRef(0)
  const latest = useRef({ clickMode, onPinClick, onMapClick })
  latest.current = { clickMode, onPinClick, onMapClick }
  const pinsRef = useRef(pins)
  pinsRef.current = pins

  useEffect(() => {
    if (!container.current) return
    const pointMode = (): boolean =>
      latest.current.clickMode === 'find-offset' || latest.current.clickMode === 'place'
    const map = new maplibregl.Map({
      container: container.current,
      style: STYLE_URL,
      center: [10, 30],
      zoom: 1.5,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    let styled = false
    map.on('style.load', () => {
      styled = true
      addLayers(map)
      setStyleVersion((v) => v + 1)
    })
    map.on('error', () => {
      if (!styled) {
        styled = true
        map.setStyle(BLANK_STYLE)
      }
    })
    map.on('click', 'pins', (e) => {
      if (pointMode()) return
      const id = e.features?.[0]?.properties?.id
      if (typeof id === 'string') latest.current.onPinClick(id)
    })
    map.on('click', (e) => {
      if (pointMode()) latest.current.onMapClick({ lat: e.lngLat.lat, lon: e.lngLat.lng })
    })
    map.on('mousemove', 'pins', (e) => {
      const id = e.features?.[0]?.properties?.id
      if (pointMode() || typeof id !== 'string') return
      map.getCanvas().style.cursor = 'pointer'
      setHover({ id, x: e.point.x, y: e.point.y })
    })
    map.on('mouseleave', 'pins', () => {
      map.getCanvas().style.cursor = pointMode() ? 'crosshair' : ''
      setHover(null)
    })
    // Test hook: the packaged e2e specs project coordinates to click positions.
    if ('stecknadelDebug' in window) Object.assign(window, { __stecknadelMap: map })
    return () => {
      cancelAnimationFrame(frame.current)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const point = clickMode === 'find-offset' || clickMode === 'place'
    if (map) map.getCanvas().style.cursor = point ? 'crosshair' : ''
    if (point) setHover(null)
  }, [clickMode])

  // Track line, and fit the view to a newly loaded track. Re-run on a new style (fresh sources).
  // biome-ignore lint/correctness/useExhaustiveDependencies: styleVersion is the trigger
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource('track') as GeoJSONSource).setData(trackFeatures(geometry))
    if (!geometry || geometry.points.length === 0) return
    const bounds = new maplibregl.LngLatBounds()
    for (const [, lat, lon] of geometry.points) bounds.extend([lon, lat])
    map.fitBounds(bounds, { padding: 48, animate: false, maxZoom: 15 })
  }, [geometry, styleVersion])

  // Pins: tween from where they are drawn to the new ExifTool positions (display only).
  // biome-ignore lint/correctness/useExhaustiveDependencies: styleVersion is the trigger
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource('pins') as GeoJSONSource
    const from = new Map(drawn.current)
    const moving = pins.filter((p) => {
      const at = from.get(p.id)
      return at && (at[0] !== p.lon || at[1] !== p.lat)
    })
    cancelAnimationFrame(frame.current)
    const target = new Map(pins.map((p): [string, Coords] => [p.id, [p.lon, p.lat]]))
    if (moving.length === 0 || reduceMotion()) {
      drawn.current = target
      source.setData(pinFeatures(pins, target, selectedId))
      return
    }
    const start = performance.now()
    const step = (now: number): void => {
      const k = Math.min(1, (now - start) / TWEEN_MS)
      const ease = 1 - (1 - k) ** 3
      const current = new Map(target)
      for (const p of moving) {
        const a = from.get(p.id) as Coords
        current.set(p.id, [a[0] + (p.lon - a[0]) * ease, a[1] + (p.lat - a[1]) * ease])
      }
      drawn.current = current
      source.setData(pinFeatures(pins, current, selectedId))
      if (k < 1) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }, [pins, selectedId, styleVersion])

  // Bring the selected photo's pin into view.
  useEffect(() => {
    const map = mapRef.current
    const pin = pinsRef.current.find((p) => p.id === selectedId)
    if (!map || !ready || !pin) return
    if (!map.getBounds().contains([pin.lon, pin.lat])) {
      map.easeTo({ center: [pin.lon, pin.lat], duration: reduceMotion() ? 0 : 300 })
    }
    // Only on selection changes, not on every preview update.
  }, [selectedId, ready])

  return (
    <div className="relative size-full">
      {/* MapLibre's stylesheet makes its container `position: relative`: size it from a wrapper. */}
      <div className="absolute inset-0">
        <div ref={container} data-testid="map" className="size-full" />
      </div>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-56 -translate-x-1/2 rounded-md border bg-popover p-2 text-popover-foreground text-xs shadow-md"
          style={{ left: hover.x, top: hover.y + 14 }}
        >
          {renderHover(hover.id)}
        </div>
      )}
      {children}
    </div>
  )
}
