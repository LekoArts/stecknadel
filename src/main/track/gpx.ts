import { emptyDropped, normalizeTrack, type Track, type TrackPoint } from '@shared/track/types'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

type Node = Record<string, unknown>

const ARRAYS = new Set(['gpx.trk', 'gpx.trk.trkseg', 'gpx.trk.trkseg.trkpt', 'gpx.wpt'])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  isArray: (_name, jpath) => ARRAYS.has(String(jpath)),
})

const list = (value: unknown): Node[] =>
  Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as Node[]) : []

const number = (value: unknown): number => {
  const s = text(value)
  return s ? Number(s) : Number.NaN
}

/** GPX times are UTC; a time without a zone designator is read as UTC, not local time. */
function parseTime(value: string | null): number {
  if (!value) return Number.NaN
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`
  return Date.parse(zoned)
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && '#text' in value) return String(value['#text']).trim()
  return null
}

export class GpxError extends Error {}

/**
 * Track points from GPX 1.0/1.1: every `<trk>/<trkseg>/<trkpt>` and every `<wpt>` (`<rte>` is
 * ignored: routes are plans, not where someone was). Points without a parseable `<time>` are
 * dropped and counted.
 */
export function parseGpx(xml: string, fileName: string): Track {
  const valid = XMLValidator.validate(xml)
  if (valid !== true) {
    throw new GpxError(`Not a valid GPX file: ${valid.err.msg} (line ${valid.err.line})`)
  }
  const doc = parser.parse(xml) as Node
  const gpx = doc.gpx as Node | undefined
  if (!gpx || typeof gpx !== 'object') throw new GpxError('Not a GPX file (no <gpx> element)')

  const nodes: Node[] = []
  for (const trk of list(gpx.trk)) {
    for (const seg of list(trk.trkseg)) nodes.push(...list(seg.trkpt))
  }
  nodes.push(...list(gpx.wpt))

  const dropped = emptyDropped()
  const raw: TrackPoint[] = []
  for (const node of nodes) {
    const ms = parseTime(text(node.time))
    if (!Number.isFinite(ms)) {
      dropped.noTime += 1
      continue
    }
    const point: TrackPoint = {
      t: ms / 1000,
      lat: number(node['@_lat']),
      lon: number(node['@_lon']),
    }
    const ele = number(node.ele)
    if (Number.isFinite(ele)) point.ele = ele
    raw.push(point)
  }
  return normalizeTrack(raw, { kind: 'gpx', fileName }, dropped)
}
