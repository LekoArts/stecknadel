import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_BRIDGE, DEFAULT_LIMITS } from '@shared/match/status'
import { z } from 'zod'

const DAY = 86_400

const matchingSchema = z.object({
  geoMaxIntSecs: z
    .number()
    .int()
    .min(60)
    .max(7 * DAY),
  geoMaxExtSecs: z
    .number()
    .int()
    .min(60)
    .max(7 * DAY),
  bridge: z.object({
    enabled: z.boolean(),
    radiusMeters: z.number().min(10).max(5000),
    maxGapHours: z.number().min(1).max(72),
  }),
  overwriteGps: z.boolean(),
})

const defaultMatching: z.infer<typeof matchingSchema> = {
  ...DEFAULT_LIMITS,
  bridge: DEFAULT_BRIDGE,
  overwriteGps: false,
}

const settingsSchema = z.object({
  dawarichUrl: z.string().nullable().catch(null),
  matching: matchingSchema.catch(defaultMatching),
})

export type Settings = z.infer<typeof settingsSchema>

const defaults: Settings = { dawarichUrl: null, matching: defaultMatching }

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
