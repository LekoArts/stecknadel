import type { PhotoSummary } from '@shared/library'
import { type MatchStatus, PLACED_KINDS } from '@shared/match/status'
import { instantSeconds } from '@shared/time/exifDate'
import type { PhotoUtc } from '@shared/time/toUtc'

export type StatusGroup = 'attention' | 'placed' | 'has-gps'
export const STATUS_GROUPS: StatusGroup[] = ['attention', 'placed', 'has-gps']
export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  attention: 'Needs attention',
  placed: 'Placed',
  'has-gps': 'Already has GPS',
}

/** Whether a photo belongs in a group; a photo without a preview status belongs to none. */
export function inGroup(
  group: StatusGroup,
  status: MatchStatus | undefined,
  time: PhotoUtc | undefined,
): boolean {
  if (!status) return false
  switch (group) {
    case 'placed':
      return PLACED_KINDS.has(status.kind)
    case 'has-gps':
      return status.kind === 'has-gps'
    case 'attention':
      return (
        (!PLACED_KINDS.has(status.kind) && status.kind !== 'has-gps') ||
        (time?.warnings.length ?? 0) > 0
      )
  }
}

export type SortKey = 'name' | 'camera' | 'captured' | 'utc' | 'status'
export interface Sort {
  key: SortKey
  dir: 'asc' | 'desc'
}

export interface SortContext {
  cameraNames: Map<string, string>
  utcs: Map<string, PhotoUtc>
  statuses: Map<string, MatchStatus>
  statusLabel: (status: MatchStatus) => string
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Sorted copy. Photos missing the sorted value go last either way; ties keep library order.
 * `null` sort keeps library order.
 */
export function sortPhotos(
  photos: PhotoSummary[],
  sort: Sort | null,
  ctx: SortContext,
): PhotoSummary[] {
  if (!sort) return photos
  const value = (p: PhotoSummary): string | number | null => {
    switch (sort.key) {
      case 'name':
        // The column shows the file name; the folder only breaks ties.
        return `${p.name}\u0000${p.relDir}`
      case 'camera':
        return ctx.cameraNames.get(p.cameraKey) ?? null
      case 'captured':
        return p.captureTime
      case 'utc': {
        const utc = ctx.utcs.get(p.id)?.utc
        return utc ? instantSeconds(utc) : null
      }
      case 'status': {
        const status = ctx.statuses.get(p.id)
        return status ? ctx.statusLabel(status) : null
      }
    }
  }
  const sign = sort.dir === 'asc' ? 1 : -1
  return photos
    .map((photo, index) => ({ photo, index, value: value(photo) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.index - b.index
        return a.value === null ? 1 : -1
      }
      const c =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : collator.compare(String(a.value), String(b.value))
      return c === 0 ? a.index - b.index : c * sign
    })
    .map((e) => e.photo)
}
