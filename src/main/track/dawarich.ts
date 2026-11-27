import { isIP } from 'node:net'
import type { FetchRange } from '@shared/track/range'
import { emptyDropped, normalizeTrack, type Track, type TrackPoint } from '@shared/track/types'

export const PER_PAGE = 1000
const TIMEOUT_MS = 30_000
const MAX_PAGES = 10_000

/** An error whose message is safe and meant for the user. Never contains the key. */
export class DawarichError extends Error {}

export interface DawarichProgress {
  page: number
  totalPages: number
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const version = isIP(host)
  if (version === 4) {
    const [a, b] = host.split('.').map(Number)
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT, e.g. Tailscale
    )
  }
  if (version === 6) {
    return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)
  }
  return false
}

/**
 * The server's base URL: https, or plain http only for localhost and private addresses (a
 * home-network or VPN server). No credentials, query or fragment in the URL.
 */
export function parseDawarichUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new DawarichError('Enter the full server address, e.g. https://dawarich.example.com')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new DawarichError('The server address must start with https://')
  }
  if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) {
    throw new DawarichError(
      'Use https:// — plain http is only allowed for localhost and private network addresses',
    )
  }
  if (url.username || url.password) {
    throw new DawarichError('Remove the user name and password from the address')
  }
  if (url.search || url.hash) {
    throw new DawarichError('Remove the “?…” or “#…” part from the address')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function networkMessage(error: unknown): string {
  const cause = (error as { cause?: { code?: string } })?.cause
  const code = cause?.code ?? ''
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'The server didn’t answer within 30 seconds'
  }
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
    return 'The server’s HTTPS certificate isn’t trusted — check the address or the certificate'
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'Couldn’t find the server — check the address and your internet connection'
  }
  if (code === 'ECONNREFUSED') return 'The server refused the connection — is Dawarich running?'
  return 'Couldn’t reach the server — check the address and your internet connection'
}

interface PageResult {
  points: unknown[]
  totalPages: number
  version: string | null
}

async function getPage(
  base: URL,
  key: string,
  range: FetchRange,
  page: number,
  perPage: number,
): Promise<PageResult> {
  const url = new URL('api/v1/points', base)
  url.searchParams.set('start_at', range.start)
  url.searchParams.set('end_at', range.end)
  url.searchParams.set('per_page', String(perPage))
  url.searchParams.set('page', String(page))
  url.searchParams.set('order', 'asc')

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      // A redirect would re-send the bearer token to wherever it points: refuse instead.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new DawarichError(networkMessage(error))
  }

  if (response.status >= 300 && response.status < 400) {
    throw new DawarichError(
      'The server redirected the request — check the address (https, no typos)',
    )
  }
  if (response.status === 401 || response.status === 403) {
    throw new DawarichError(
      'The API key was rejected — copy it again from Dawarich’s account settings',
    )
  }
  if (response.status === 404) {
    throw new DawarichError('No Dawarich API at this address — check the URL')
  }
  if (!response.ok) {
    throw new DawarichError(`The server answered with an error (HTTP ${response.status})`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new DawarichError('The server didn’t answer with Dawarich data — check the URL')
  }
  if (!Array.isArray(body)) {
    throw new DawarichError('The server didn’t answer with Dawarich data — check the URL')
  }
  const totalPages = Number(response.headers.get('x-total-pages'))
  return {
    points: body,
    totalPages: Number.isInteger(totalPages) && totalPages > 0 ? totalPages : 1,
    version: response.headers.get('x-dawarich-version'),
  }
}

const num = (value: unknown): number =>
  value === null || value === undefined || value === '' ? Number.NaN : Number(value)

/** Fetches every point in `range` (all pages, oldest first) and normalizes them. */
export async function fetchDawarichTrack(
  baseUrl: string,
  key: string,
  range: FetchRange,
  onProgress?: (progress: DawarichProgress) => void,
): Promise<Track> {
  const base = parseDawarichUrl(baseUrl)
  const dropped = emptyDropped()
  const raw: TrackPoint[] = []
  let totalPages = 1
  for (let page = 1; page <= totalPages && page <= MAX_PAGES; page++) {
    const result = await getPage(base, key, range, page, PER_PAGE)
    totalPages = result.totalPages
    for (const item of result.points) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>
      if (p.anomaly === true) {
        dropped.anomaly += 1
        continue
      }
      const point: TrackPoint = { t: num(p.timestamp), lat: num(p.latitude), lon: num(p.longitude) }
      const ele = num(p.altitude)
      if (Number.isFinite(ele)) point.ele = ele
      raw.push(point)
    }
    onProgress?.({ page, totalPages })
  }
  return normalizeTrack(raw, { kind: 'dawarich', start: range.start, end: range.end }, dropped)
}

/** Checks address and key with a one-point request; returns the server's Dawarich version. */
export async function testDawarich(
  baseUrl: string,
  key: string,
): Promise<{ version: string | null }> {
  const base = parseDawarichUrl(baseUrl)
  const end = new Date()
  const start = new Date(end.getTime() - 24 * 3600 * 1000)
  const { version } = await getPage(
    base,
    key,
    { start: start.toISOString(), end: end.toISOString() },
    1,
    1,
  )
  return { version }
}
