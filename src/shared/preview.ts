import { z } from 'zod'
import { PHOTO_ID_PATTERN } from './library'
import type { BridgedInterval, MatchStatus } from './match/status'
import { cameraTimeSettingsSchema } from './time/cameraSettings'

export const positionSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  ele: z.number().min(-1000).max(100_000).nullable(),
})

export type Position = z.infer<typeof positionSchema>

export const previewInputSchema = z.strictObject({
  /** Monotonically increasing per renderer; superseded runs come back as null. */
  generation: z.number().int().positive(),
  cameras: z.record(z.string().min(1).max(500), cameraTimeSettingsSchema),
  /** Manual placements by photo ID. */
  manual: z.record(z.string().regex(PHOTO_ID_PATTERN), positionSchema),
})

export type PreviewInput = z.infer<typeof previewInputSchema>

export interface PhotoPreview {
  id: string
  status: MatchStatus
  /** ExifTool's position (or the manual one); null when not placed. */
  position: Position | null
  /** Computed UTC capture time, Unix seconds. */
  utc: number | null
}

export interface PreviewSnapshot {
  generation: number
  results: PhotoPreview[]
  /** Camera keys that went through ExifTool in this run (the others came from the cache). */
  recomputed: string[]
  durationMs: number
}

/** The loaded track for drawing and the offset finder: `[t, lat, lon]` per point. */
export interface TrackGeometry {
  points: [number, number, number][]
  /** Stationary gaps the preview bridges, under the current settings. */
  intervals: BridgedInterval[]
  geoMaxIntSecs: number
}
