import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

const settingsSchema = z.object({
  dawarichUrl: z.string().nullable().catch(null),
})

export type Settings = z.infer<typeof settingsSchema>

const defaults: Settings = { dawarichUrl: null }

/** `settings.json` in userData. Unknown or invalid fields fall back to defaults. */
export class SettingsStore {
  private current: Settings = { ...defaults }

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const parsed = settingsSchema.safeParse(JSON.parse(await readFile(this.file, 'utf8')))
      this.current = parsed.success ? parsed.data : { ...defaults }
    } catch {
      this.current = { ...defaults }
    }
  }

  get(): Settings {
    return this.current
  }

  async update(patch: Partial<Settings>): Promise<void> {
    const next = { ...this.current, ...patch }
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`)
    await rename(tmp, this.file)
    this.current = next
  }
}
