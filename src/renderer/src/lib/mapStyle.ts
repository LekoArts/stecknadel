import type { MapSourceView } from '@shared/settings'
import { PMTILES_URL } from '@shared/settings'
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
import { PMTiles, Protocol, TileType } from 'pmtiles'

export const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

/** Used when the map style can't be loaded (offline): track and pins still show. */
export const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f4f4f5' } }],
}

const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile)

const ATTRIBUTION = 'Local map file'

/**
 * A minimal style for whatever the PMTiles file holds: raster tiles as one raster layer, vector
 * tiles as a fill and a line layer per vector layer the file declares.
 */
async function pmtilesStyle(revision: number): Promise<StyleSpecification> {
  // The query only busts the pmtiles reader's cache when another file is picked; main serves
  // the chosen file whatever it says.
  const archive = new PMTiles(`${PMTILES_URL}?r=${revision}`)
  protocol.add(archive)
  const header = await archive.getHeader()
  const url = `pmtiles://${archive.source.getKey()}`
  const bounds: [number, number, number, number] = [
    header.minLon,
    header.minLat,
    header.maxLon,
    header.maxLat,
  ]
  const background: LayerSpecification = {
    id: 'background',
    type: 'background',
    paint: { 'background-color': '#f4f4f5' },
  }
  if (header.tileType !== TileType.Mvt) {
    return {
      version: 8,
      sources: {
        local: {
          type: 'raster',
          url,
          tileSize: 256,
          bounds,
          minzoom: header.minZoom,
          maxzoom: header.maxZoom,
          attribution: ATTRIBUTION,
        },
      },
      layers: [background, { id: 'local-raster', type: 'raster', source: 'local' }],
    }
  }
  const metadata = (await archive.getMetadata()) as { vector_layers?: { id: string }[] }
  const ids = (metadata.vector_layers ?? []).map((l) => l.id)
  return {
    version: 8,
    sources: { local: { type: 'vector', url, attribution: ATTRIBUTION } },
    layers: [
      background,
      ...ids.flatMap((id): LayerSpecification[] => [
        {
          id: `${id}-fill`,
          type: 'fill',
          source: 'local',
          'source-layer': id,
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': '#d4d4d8', 'fill-opacity': 0.5 },
        },
        {
          id: `${id}-line`,
          type: 'line',
          source: 'local',
          'source-layer': id,
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': '#a1a1aa', 'line-width': 1 },
        },
      ]),
    ],
  }
}

export function resolveStyle(
  source: MapSourceView,
  revision: number,
): Promise<string | StyleSpecification> {
  if (source.kind === 'openfreemap') return Promise.resolve(OPENFREEMAP_STYLE)
  if (source.kind === 'style') return Promise.resolve(source.url)
  return pmtilesStyle(revision)
}
