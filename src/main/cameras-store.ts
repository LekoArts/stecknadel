import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** `cameras.json` in userData: camera key → user-chosen name. Names only (user decision 4). */
export class CameraNames {
  private names: Record<string, string> = {}

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.names = Object.fromEntries(
          Object.entries(parsed).filter(([, v]) => typeof v === 'string'),
        ) as Record<string, string>
      }
    } catch {
      this.names = {}
    }
  }

  all(): Record<string, string> {
    return this.names
  }

  /** Sets a name; an empty name restores the default. */
  async set(key: string, name: string): Promise<void> {
    const trimmed = name.trim()
    const next = { ...this.names }
    if (trimmed) next[key] = trimmed
    else delete next[key]
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`)
    await rename(tmp, this.file)
    this.names = next
  }
}
