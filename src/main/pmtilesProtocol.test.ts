import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PMTILES_URL } from '@shared/settings'
import { FetchSource, PMTiles, TileType } from 'pmtiles'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseRange, servePmtiles } from './pmtilesProtocol'

const fixture = join(__dirname, '../../test/fixtures/tiny.pmtiles')
let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'steck-pmtiles-'))
})
afterAll(() => rm(dir, { recursive: true, force: true }))

const get = (url: string, file: string | null, range?: string) =>
  servePmtiles(new Request(url, { headers: range ? { range } : {} }), file)

describe('parseRange', () => {
  it.each([
    ['bytes=0-9', 100, [0, 9]],
    ['bytes=90-', 100, [90, 99]],
    ['bytes=0-16383', 100, [0, 99]],
    ['bytes=100-200', 100, 'unsatisfiable'],
    ['bytes=9-0', 100, null],
    ['bytes=-5', 100, null],
    ['items=0-1', 100, null],
    ['bytes=0-1,4-5', 100, null],
  ])('%s of %d → %o', (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected)
  })
})

describe('stecknadel-pmtiles protocol', () => {
  it('answers ranges with 206 and Content-Range', async () => {
    const res = await get(PMTILES_URL, fixture, 'bytes=0-6')
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-6\/\d+$/)
    expect(res.headers.get('content-length')).toBe('7')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('PMTiles')
  })

  it('clamps a range past the end, and answers 416 with the size when it starts past it', async () => {
    const whole = await get(PMTILES_URL, fixture)
    expect(whole.status).toBe(200)
    const size = (await whole.arrayBuffer()).byteLength
    const tail = await get(PMTILES_URL, fixture, `bytes=${size - 3}-${size + 100}`)
    expect(tail.status).toBe(206)
    expect((await tail.arrayBuffer()).byteLength).toBe(3)
    const past = await get(PMTILES_URL, fixture, `bytes=${size}-${size + 10}`)
    expect(past.status).toBe(416)
    expect(past.headers.get('content-range')).toBe(`bytes */${size}`)
  })

  it('serves only the chosen file, at the fixed URL', async () => {
    const other = join(dir, 'other.pmtiles')
    await writeFile(other, 'other')
    for (const url of [
      'stecknadel-pmtiles://map/other.pmtiles',
      'stecknadel-pmtiles://map/../other.pmtiles',
      `stecknadel-pmtiles://map/${encodeURIComponent(other)}`,
      `stecknadel-pmtiles://map/%2e%2e%2fother.pmtiles`,
      'stecknadel-pmtiles://other/tiles.pmtiles',
      `${PMTILES_URL}/x`,
    ]) {
      expect((await get(url, fixture)).status, url).toBe(404)
    }
    expect((await get(PMTILES_URL, null)).status).toBe(404)
    expect((await get(PMTILES_URL, join(dir, 'missing.pmtiles'))).status).toBe(404)
    expect((await get(PMTILES_URL, dir)).status).toBe(404)
    // A settings file hand-edited to point somewhere else still only reaches .pmtiles files.
    const passwd = join(dir, 'passwd')
    await writeFile(passwd, 'root:x:0:0')
    expect((await get(PMTILES_URL, passwd)).status).toBe(404)
    const link = join(dir, 'dir-link.pmtiles')
    await symlink(dir, link)
    expect((await get(PMTILES_URL, link)).status).toBe(404)
  })

  it('refuses writes and answers CORS preflight', async () => {
    const post = await servePmtiles(
      new Request(PMTILES_URL, { method: 'POST', body: 'x' }),
      fixture,
    )
    expect(post.status).toBe(404)
    const pre = await servePmtiles(new Request(PMTILES_URL, { method: 'OPTIONS' }), fixture)
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-headers')).toBe('range')
  })

  it('the pmtiles reader reads the fixture through it: raster PNG tiles, zooms 0–2', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) =>
        servePmtiles(new Request(input as string, init), fixture),
      )
    try {
      const archive = new PMTiles(new FetchSource(PMTILES_URL))
      const header = await archive.getHeader()
      expect(header).toMatchObject({
        specVersion: 3,
        tileType: TileType.Png,
        minZoom: 0,
        maxZoom: 2,
      })
      expect(header.numAddressedTiles).toBe(21)
      for (const [z, x, y] of [
        [0, 0, 0],
        [1, 1, 0],
        [2, 3, 3],
      ]) {
        const tile = await archive.getZxy(z, x, y)
        expect(
          Buffer.from(tile?.data ?? new ArrayBuffer(0))
            .subarray(1, 4)
            .toString(),
        ).toBe('PNG')
      }
      expect(await archive.getZxy(3, 0, 0)).toBeUndefined()
      expect(await archive.getMetadata()).toMatchObject({ name: 'Stecknadel test tiles' })
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
