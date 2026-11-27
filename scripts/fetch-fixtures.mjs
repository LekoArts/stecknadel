// Downloads the pinned test fixtures (CC0 RAWs + ExifTool test images) into test/fixtures/cache/,
// verifying size and sha256 against test/fixtures/fixtures.lock.json. Files already present with a
// matching hash are skipped. Exits non-zero on any mismatch or download failure.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const lockPath = join(root, 'test/fixtures/fixtures.lock.json')
export const cacheDir = join(root, 'test/fixtures/cache')

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** Returns `null` when `path` matches the lock entry, otherwise a human-readable mismatch reason. */
export async function verifyFile(path, entry) {
  let info
  try {
    info = await stat(path)
  } catch {
    return 'missing'
  }
  if (info.size !== entry.size) return `size ${info.size} ≠ ${entry.size}`
  const actual = await sha256File(path)
  if (actual !== entry.sha256) return `sha256 ${actual} ≠ ${entry.sha256}`
  return null
}

async function download(entry) {
  const target = join(cacheDir, entry.name)
  if ((await verifyFile(target, entry)) === null) {
    console.log(`ok (cached)  ${entry.name}`)
    return true
  }
  const res = await fetch(entry.url)
  if (!res.ok) {
    console.error(`FAIL ${entry.name}: HTTP ${res.status}`)
    return false
  }
  const tmp = `${target}.part`
  await writeFile(tmp, Buffer.from(await res.arrayBuffer()))
  const problem = await verifyFile(tmp, entry)
  if (problem) {
    await rm(tmp, { force: true })
    console.error(`FAIL ${entry.name}: ${problem}`)
    return false
  }
  await rename(tmp, target)
  console.log(`ok (fetched) ${entry.name}`)
  return true
}

async function main() {
  const { files } = JSON.parse(await readFile(lockPath, 'utf8'))
  await mkdir(cacheDir, { recursive: true })
  const results = await Promise.all(files.map(download))
  if (results.includes(false)) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
