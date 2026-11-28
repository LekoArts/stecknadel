// electron-builder afterPack hook (macOS): give the app's executables their own Mach-O UUIDs.
//
// electron-builder ships Electron's prebuilt executables, so Stecknadel's main binary has the same
// LC_UUID as every other app on this Electron release. macOS's Local Network privacy identifies a
// program partly by that UUID, so it can apply another Electron app's decision to Stecknadel and
// never ask: connections to a Dawarich server at home then fail with EHOSTUNREACH. Runs before
// signing, which re-signs the patched files.
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MH_MAGIC_64 = 0xfeedfacf
const LC_UUID = 0x1b

/** Replaces the LC_UUID of a thin 64-bit little-endian Mach-O with one derived from `salt`. */
export function rewriteUuid(buffer, salt) {
  if (buffer.length < 32 || buffer.readUInt32LE(0) !== MH_MAGIC_64) {
    throw new Error('Not a thin 64-bit Mach-O file')
  }
  const count = buffer.readUInt32LE(16)
  let offset = 32
  for (let i = 0; i < count; i++) {
    const cmd = buffer.readUInt32LE(offset)
    const size = buffer.readUInt32LE(offset + 4)
    if (cmd === LC_UUID) {
      const old = Buffer.from(buffer.subarray(offset + 8, offset + 24))
      const uuid = createHash('sha256').update(salt).update(old).digest().subarray(0, 16)
      uuid[6] = (uuid[6] & 0x0f) | 0x50 // RFC 4122 version 5 style, variant 1
      uuid[8] = (uuid[8] & 0x3f) | 0x80
      uuid.copy(buffer, offset + 8)
      return { from: formatUuid(old), to: formatUuid(uuid) }
    }
    offset += size
  }
  throw new Error('No LC_UUID load command')
}

function formatUuid(bytes) {
  const h = Buffer.from(bytes).toString('hex').toUpperCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const { id: appId, productFilename } = context.packager.appInfo
  const app = join(context.appOutDir, `${productFilename}.app`)
  const executables = [join(app, 'Contents/MacOS', productFilename)]
  const frameworks = join(app, 'Contents/Frameworks')
  for (const entry of await readdir(frameworks)) {
    if (!entry.endsWith('.app')) continue
    executables.push(join(frameworks, entry, 'Contents/MacOS', entry.slice(0, -'.app'.length)))
  }
  for (const file of executables) {
    const buffer = await readFile(file)
    rewriteUuid(buffer, appId)
    await writeFile(file, buffer)
  }
}
