import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { defaultFetchRange } from '@shared/track/range'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DawarichError, fetchDawarichTrack, parseDawarichUrl, testDawarich } from './dawarich'

const KEY = 'test-key-0123456789'
const range = { start: '2026-11-01T00:00:00Z', end: '2026-11-18T00:00:00Z' }

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void
let handler: Handler
const requests: { url: URL; auth: string | undefined }[] = []
let server: Server
let base: string

const listen = (s: Server): Promise<string> =>
  new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`),
    ),
  )

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    requests.push({ url, auth: req.headers.authorization })
    handler(req, res, url)
  })
  base = await listen(server)
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
afterEach(() => {
  requests.length = 0
})

const json = (res: ServerResponse, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(200, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

const point = (i: number, extra: Record<string, unknown> = {}) => ({
  id: i,
  latitude: String(47 + i / 1000),
  longitude: String(8 + i / 1000),
  altitude: 400 + i,
  timestamp: 1_793_000_000 + i * 60,
  ...extra,
})

describe('fetchDawarichTrack', () => {
  it('follows x-total-pages, parses string coordinates and skips anomalies', async () => {
    handler = (_req, res, url) => {
      const page = Number(url.searchParams.get('page'))
      const items: Record<string, unknown>[] = [0, 1, 2].map((i) => point((page - 1) * 3 + i))
      if (page === 2) items[1] = { ...items[1], anomaly: true }
      json(res, items, { 'x-total-pages': '3', 'x-dawarich-version': '0.30.0' })
    }
    const progress = vi.fn()
    const track = await fetchDawarichTrack(base, KEY, range, progress)
    expect(track.points).toHaveLength(8)
    expect(track.dropped.anomaly).toBe(1)
    expect(track.points[0]).toEqual({ t: 1_793_000_000, lat: 47, lon: 8, ele: 400 })
    expect(track.points.every((p, i, a) => i === 0 || p.t > a[i - 1].t)).toBe(true)
    expect(track.source).toEqual({ kind: 'dawarich', ...range })
    expect(progress.mock.calls.map(([p]) => p)).toEqual([
      { page: 1, totalPages: 3 },
      { page: 2, totalPages: 3 },
      { page: 3, totalPages: 3 },
    ])

    expect(requests.map((r) => r.url.searchParams.get('page'))).toEqual(['1', '2', '3'])
    for (const { url, auth } of requests) {
      expect(url.pathname).toBe('/api/v1/points')
      expect(auth).toBe(`Bearer ${KEY}`)
      expect(url.search).not.toContain(KEY)
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        start_at: range.start,
        end_at: range.end,
        per_page: '1000',
        order: 'asc',
      })
    }
  })

  it('keeps the base path of a server behind a sub-path', async () => {
    handler = (_req, res) => json(res, [])
    await fetchDawarichTrack(`${base}/dawarich`, KEY, range)
    expect(requests[0].url.pathname).toBe('/dawarich/api/v1/points')
  })

  it('maps 401 to an API-key message', async () => {
    handler = (_req, res) => {
      res.writeHead(401)
      res.end()
    }
    await expect(fetchDawarichTrack(base, KEY, range)).rejects.toThrow(/API key was rejected/)
  })

  it.each([
    [404, /No Dawarich API/],
    [500, /HTTP 500/],
  ])('maps HTTP %i to a message', async (status, message) => {
    handler = (_req, res) => {
      res.writeHead(status)
      res.end()
    }
    await expect(fetchDawarichTrack(base, KEY, range)).rejects.toThrow(message)
  })

  it('rejects non-JSON and non-array answers', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>login</html>')
    }
    await expect(fetchDawarichTrack(base, KEY, range)).rejects.toThrow(/Dawarich data/)
    handler = (_req, res) => json(res, { error: 'nope' })
    await expect(fetchDawarichTrack(base, KEY, range)).rejects.toThrow(/Dawarich data/)
  })

  it('maps a refused connection to a message', async () => {
    const closed = createServer()
    const url = await listen(closed)
    await new Promise<void>((resolve) => closed.close(() => resolve()))
    await expect(fetchDawarichTrack(url, KEY, range)).rejects.toThrow(/refused/)
  })

  it('refuses a redirect, and the redirect target never receives the key', async () => {
    const target: (string | undefined)[] = []
    const other = createServer((req, res) => {
      target.push(req.headers.authorization)
      json(res, [point(0)])
    })
    const otherUrl = await listen(other)
    handler = (_req, res) => {
      res.writeHead(302, { location: `${otherUrl}/api/v1/points` })
      res.end()
    }
    try {
      await expect(fetchDawarichTrack(base, KEY, range)).rejects.toThrow(/redirected/)
      expect(target).toEqual([])
    } finally {
      await new Promise<void>((resolve) => other.close(() => resolve()))
    }
  })

  it('never logs or puts the key into an error', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    )
    handler = (_req, res) => {
      res.writeHead(401)
      res.end()
    }
    try {
      const error = await fetchDawarichTrack(base, KEY, range).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(DawarichError)
      expect(JSON.stringify({ ...(error as object), m: (error as Error).message })).not.toContain(
        KEY,
      )
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

describe('testDawarich', () => {
  it('requests one point and reports the server version', async () => {
    handler = (_req, res) => json(res, [], { 'x-dawarich-version': '0.30.0' })
    await expect(testDawarich(base, KEY)).resolves.toEqual({ version: '0.30.0' })
    expect(requests[0].url.searchParams.get('per_page')).toBe('1')
  })
})

describe('parseDawarichUrl', () => {
  it.each([
    'https://dawarich.example.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://192.168.1.20:3000',
    'http://10.0.0.5',
    'http://172.20.0.2',
    'http://100.101.102.103',
    'http://[::1]:3000',
    'http://[fd12:3456::1]',
    'http://dawarich.localhost',
  ])('accepts %s', (url) => {
    expect(parseDawarichUrl(url).href.endsWith('/')).toBe(true)
  })

  it.each([
    ['http://dawarich.example.com', /https/],
    ['http://172.32.0.1', /https/],
    ['http://8.8.8.8', /https/],
    ['ftp://dawarich.example.com', /https/],
    ['dawarich.example.com', /full server address/],
    ['https://user:pass@dawarich.example.com', /user name/],
    ['https://dawarich.example.com/?token=x', /“\?…”/],
  ])('rejects %s', (url, message) => {
    expect(() => parseDawarichUrl(url)).toThrow(message)
  })
})

describe('defaultFetchRange', () => {
  it('spans the raw wall times ± 26 h ± GeoMaxExtSecs', () => {
    expect(
      defaultFetchRange([
        '2026:11:05 10:00:00',
        null,
        '2026:11:02 08:30:00',
        '2026:11:16 18:00:00',
      ]),
    ).toEqual({ start: '2026-11-01T06:00:00Z', end: '2026-11-17T20:30:00Z' })
    expect(defaultFetchRange(['2026:11:02 08:30:00'], 0)).toEqual({
      start: '2026-11-01T06:30:00Z',
      end: '2026-11-03T10:30:00Z',
    })
    expect(defaultFetchRange([null, 'garbage'])).toBeNull()
  })
})
