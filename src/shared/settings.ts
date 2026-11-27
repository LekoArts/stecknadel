import { z } from 'zod'
import { DEFAULT_BRIDGE, DEFAULT_LIMITS } from './match/status'

const DAY = 86_400

// User decision 20: limits 60 s … 7 days; bridging 10–5000 m, 1–72 h.
const seconds = z
  .number()
  .int()
  .min(60)
  .max(7 * DAY)

export const matchingSchema = z.strictObject({
  geoMaxIntSecs: seconds,
  geoMaxExtSecs: seconds,
  bridge: z.strictObject({
    enabled: z.boolean(),
    radiusMeters: z.number().int().min(10).max(5000),
    maxGapHours: z.number().int().min(1).max(72),
  }),
})

export const writingSchema = z.strictObject({
  overwriteGps: z.boolean(),
  writeOffsetTime: z.boolean(),
  /** In-file, or an `IMG_1234.xmp` sidecar next to RAWs (JPEG/HEIC always in-file). */
  rawTarget: z.enum(['in-file', 'sidecar']),
  backups: z.boolean(),
})

const styleUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:'
    } catch {
      return false
    }
  }, 'an https:// style URL')

/** What main stores. The PMTiles path never reaches the renderer. */
export const mapSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('openfreemap') }),
  z.strictObject({ kind: z.literal('style'), url: styleUrl }),
  z.strictObject({ kind: z.literal('pmtiles'), path: z.string().min(1) }),
])

export type MatchingSettings = z.infer<typeof matchingSchema>
export type WritingSettings = z.infer<typeof writingSchema>
export type MapSource = z.infer<typeof mapSourceSchema>

export const DEFAULT_MATCHING: MatchingSettings = {
  ...DEFAULT_LIMITS,
  bridge: { ...DEFAULT_BRIDGE },
}
export const DEFAULT_WRITING: WritingSettings = {
  overwriteGps: false,
  writeOffsetTime: true,
  rawTarget: 'in-file',
  backups: false,
}

/** The map source as the renderer sees it: a PMTiles file by name only. */
export type MapSourceView =
  | { kind: 'openfreemap' }
  | { kind: 'style'; url: string }
  | { kind: 'pmtiles'; name: string }

export interface SettingsView {
  matching: MatchingSettings
  writing: WritingSettings
  mapSource: MapSourceView
}

/** What the renderer may save. `pmtiles` keeps the file chosen through main's picker. */
export const saveSettingsSchema = z.strictObject({
  matching: matchingSchema,
  writing: writingSchema,
  mapSource: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('openfreemap') }),
    z.strictObject({ kind: z.literal('style'), url: styleUrl }),
    z.strictObject({ kind: z.literal('pmtiles') }),
  ]),
})

export type SaveSettingsInput = z.infer<typeof saveSettingsSchema>

/** The host the PMTiles protocol answers on; the file itself comes from settings. */
export const PMTILES_URL = 'stecknadel-pmtiles://map/tiles.pmtiles'
