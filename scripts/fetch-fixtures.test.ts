import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifyFile } from './fetch-fixtures.mjs'

describe('fetch-fixtures verifyFile', () => {
  let dir: string
  let file: string
  const content = Buffer.from('stecknadel fixture')
  const entry = {
    name: 'sample.bin',
    url: 'https://example.invalid/sample.bin',
    sha256: createHash('sha256').update(content).digest('hex'),
    size: content.length,
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'steck-fixtures-'))
    file = join(dir, entry.name)
    await writeFile(file, content)
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('accepts a file matching size and sha256', async () => {
    expect(await verifyFile(file, entry)).toBeNull()
  })

  it('detects a hash mismatch at equal size', async () => {
    const tampered = Buffer.from(content)
    tampered[0] ^= 0xff
    await writeFile(file, tampered)
    expect(await verifyFile(file, entry)).toMatch(/^sha256 /)
  })

  it('detects a size mismatch', async () => {
    await writeFile(file, Buffer.concat([content, Buffer.from('x')]))
    expect(await verifyFile(file, entry)).toMatch(/^size /)
  })

  it('reports a missing file', async () => {
    expect(await verifyFile(join(dir, 'nope.bin'), entry)).toBe('missing')
  })
})
