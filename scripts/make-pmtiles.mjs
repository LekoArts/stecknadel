// Writes test/fixtures/tiny.pmtiles: a raster PMTiles v3 archive (zooms 0–2, solid-color PNG
// tiles), built by hand from the spec so the e2e can render a local map without the network.
// https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const out = join(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/tiny.pmtiles')

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** A 256×256 RGB PNG of one color. */
function solidPng([r, g, b]) {
  const size = 256
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 2, 0, 0, 0], 8) // 8-bit, truecolor, deflate, no filter, no interlace
  const row = Buffer.alloc(1 + size * 3)
  for (let x = 0; x < size; x++) row.set([r, g, b], 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function varint(n) {
  const bytes = []
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80)
    n = Math.floor(n / 128)
  }
  bytes.push(n)
  return bytes
}

const contents = [
  [0xd8, 0xe4, 0xd0], // pale green
  [0xb8, 0xd4, 0xe8], // pale blue
  [0xe8, 0xdc, 0xc4], // sand
].map(solidPng)
let offset = 0
const contentOffsets = contents.map((c) => {
  const o = offset
  offset += c.length
  return o
})
const tileData = Buffer.concat(contents)

// Zooms 0–2 hold 1 + 4 + 16 = 21 tiles, tile IDs 0…20 in Hilbert order.
const MAX_ZOOM = 2
const count = 21
const entries = Array.from({ length: count }, (_, id) => ({
  id,
  content: id % contents.length,
}))
const dir = [
  ...varint(entries.length),
  ...entries.flatMap((e, i) => varint(i === 0 ? e.id : e.id - entries[i - 1].id)),
  ...entries.flatMap(() => varint(1)), // run lengths
  ...entries.flatMap((e) => varint(contents[e.content].length)),
  // Offsets are stored +1 (0 would mean "right after the previous tile").
  ...entries.flatMap((e) => varint(contentOffsets[e.content] + 1)),
]
const root = Buffer.from(dir)
const metadata = Buffer.from(
  JSON.stringify({ name: 'Stecknadel test tiles', attribution: 'Synthetic' }),
)

const HEADER = 127
const header = Buffer.alloc(HEADER)
header.write('PMTiles', 0, 'ascii')
header.writeUInt8(3, 7)
const u64 = (pos, v) => header.writeBigUInt64LE(BigInt(v), pos)
const rootOffset = HEADER
const metaOffset = rootOffset + root.length
const dataOffset = metaOffset + metadata.length
u64(8, rootOffset)
u64(16, root.length)
u64(24, metaOffset)
u64(32, metadata.length)
u64(40, dataOffset) // no leaf directories
u64(48, 0)
u64(56, dataOffset)
u64(64, tileData.length)
u64(72, count) // addressed tiles
u64(80, entries.length) // tile entries
u64(88, contents.length) // tile contents
header.writeUInt8(0, 96) // not clustered: entries share contents
header.writeUInt8(1, 97) // internal compression: none
header.writeUInt8(1, 98) // tile compression: none
header.writeUInt8(2, 99) // tile type: png
header.writeUInt8(0, 100)
header.writeUInt8(MAX_ZOOM, 101)
const e7 = (v) => Math.round(v * 1e7)
header.writeInt32LE(e7(-180), 102)
header.writeInt32LE(e7(-85.0511), 106)
header.writeInt32LE(e7(180), 110)
header.writeInt32LE(e7(85.0511), 114)
header.writeUInt8(1, 118)
header.writeInt32LE(e7(8), 119)
header.writeInt32LE(e7(46.5), 123)

writeFileSync(out, Buffer.concat([header, root, metadata, tileData]))
console.log(`wrote ${out}`)
