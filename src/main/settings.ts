import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  DEFAULT_MATCHING,
  DEFAULT_WRITING,
  type MapSource,
  type MatchingSettings,
  mapSourceSchema,
  matchingSchema,
  type WritingSettings,
  writingSchema,
} from '@shared/settings'
import { z } from 'zod'

export interface Settings {
  dawarichUrl: string | null
  matching: MatchingSettings
  writing: WritingSettings
  mapSource: MapSource
}

export const DEFAULT_SETTINGS: Settings = {
  dawarichUrl: null,
  matching: DEFAULT_MATCHING,
  writing: DEFAULT_WRITING,
  mapSource: { kind: 'openfreemap' },
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Field by field: valid stored values are kept, missing or invalid ones take the default. */
function mergeValid<T>(schema: z.ZodObject, defaults: T, raw: unknown): T {
  const out = { ...defaults } as Record<string, unknown>
  if (!isRecord(raw)) return out as T
  for (const [key, field] of Object.entries(schema.shape)) {
    if (!(key in raw)) continue
    if (field instanceof z.ZodObject) out[key] = mergeValid(field, out[key], raw[key])
    else {
      const parsed = (field as z.ZodType).safeParse(raw[key])
      if (parsed.success) out[key] = parsed.data
    }
  }
  return out as T
}

/** Reads any earlier or hand-edited `settings.json` into a valid Settings. */
export function migrateSettings(raw: unknown): Settings {
  const r = isRecord(raw) ? raw : {}
  const writingRaw = { ...(isRecord(r.writing) ? r.writing : {}) }
  // Before the Settings phase, overwriteGps lived under matching.
  if (!('overwriteGps' in writingRaw) && isRecord(r.matching) && 'overwriteGps' in r.matching)
    writingRaw.overwriteGps = r.matching.overwriteGps
  const url = z.string().min(1).safeParse(r.dawarichUrl)
  const map = mapSourceSchema.safeParse(r.mapSource)
  return {
    dawarichUrl: url.success ? url.data : null,
    matching: mergeValid(matchingSchema, DEFAULT_MATCHING, r.matching),
    writing: mergeValid(writingSchema, DEFAULT_WRITING, writingRaw),
    mapSource: map.success ? map.data : DEFAULT_SETTINGS.mapSource,
  }
}

/** `settings.json` in userData, zod-validated with defaults. */
export class SettingsStore {
  private current: Settings = DEFAULT_SETTINGS

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      this.current = migrateSettings(JSON.parse(await readFile(this.file, 'utf8')))
    } catch {
      this.current = DEFAULT_SETTINGS
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
