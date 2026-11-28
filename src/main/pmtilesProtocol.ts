import { type FileHandle, open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { PMTILES_URL } from '@shared/settings'

const CHUNK = 64 * 1024

/**
 * Bytes `start..end` (inclusive) of `file`, read one chunk per pull: an unread response holds a
 * chunk, not the archive. Hand-rolled because `Readable.toWeb` throws an unhandled error when
 * the reader cancels while a read is in flight, as MapLibre does when it aborts a tile.
 */
function fileRange(file: string, start: number, end: number): ReadableStream<Uint8Array> {
  let handle: Promise<FileHandle> | null = null
  let pos = start
  let done = false
  const close = async (): Promise<void> => {
    if (done) return
    done = true
    await (await handle)?.close()
  }
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        handle ??= open(file, 'r')
        const size = Math.min(CHUNK, end + 1 - pos)
        const buf = Buffer.alloc(Math.max(size, 0))
        const { bytesRead } =
          size > 0 ? await (await handle).read(buf, 0, size, pos) : { bytesRead: 0 }
        if (done) return // cancelled while reading
        if (bytesRead === 0) {
          await close()
          controller.close()
          return
        }
        pos += bytesRead
        controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, bytesRead))
      },
      cancel: close,
    },
    { highWaterMark: 0 },
  )
}

export const PMTILES_SCHEME = 'stecknadel-pmtiles'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'range',
  'access-control-expose-headers': 'content-range, content-length, etag',
}

/** `bytes=a-b` or `bytes=a-` → [start, end] inclusive, clamped to the file; null when malformed. */
export function parseRange(
  header: string,
  size: number,
): [number, number] | 'unsatisfiable' | null {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const start = Number(m[1])
  const end = m[2] === '' ? size - 1 : Number(m[2])
  if (end < start) return null
  if (start >= size) return 'unsatisfiable'
  return [start, Math.min(end, size - 1)]
}

/**
 * Serves the PMTiles file the user picked in main's dialog — and nothing else: the request URL
 * only names the fixed `PMTILES_URL`, never a path. Byte ranges as the `pmtiles` FetchSource
 * expects them (206 with Content-Range, 416 with `bytes *\/size`).
 */
export async function servePmtiles(request: Request, file: string | null): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = new URL(request.url)
  const expected = new URL(PMTILES_URL)
  if (
    url.host !== expected.host ||
    decodeURIComponent(url.pathname) !== expected.pathname ||
    !file ||
    extname(file).toLowerCase() !== '.pmtiles' ||
    (request.method !== 'GET' && request.method !== 'HEAD')
  ) {
    return new Response(null, { status: 404, headers: CORS })
  }
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(file)
  } catch {
    return new Response(null, { status: 404, headers: CORS })
  }
  if (!info.isFile()) return new Response(null, { status: 404, headers: CORS })

  const size = info.size
  const etag = `"${size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
  const headers = {
    ...CORS,
    etag,
    'accept-ranges': 'bytes',
    'content-type': 'application/octet-stream',
  }
  const rangeHeader = request.headers.get('range')
  const range = rangeHeader ? parseRange(rangeHeader, size) : ([0, size - 1] as [number, number])
  if (range === 'unsatisfiable' || range === null) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'content-range': `bytes */${size}` },
    })
  }
  const [start, end] = range
  const length = end - start + 1
  // Streamed, so a multi-gigabyte archive never sits in main's memory; HEAD reads nothing.
  const body = request.method === 'GET' && length > 0 ? fileRange(file, start, end) : null
  return new Response(body, {
    status: rangeHeader ? 206 : 200,
    headers: {
      ...headers,
      'content-length': String(length),
      ...(rangeHeader ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
    },
  })
}
