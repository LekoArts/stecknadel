import type { MatchKind } from '@shared/match/status'

/** Pin and legend colors per status (hex: MapLibre paint needs literal colors). */
export const STATUS_COLORS: Record<MatchKind, string> = {
  matched: '#16a34a',
  'matched-stay': '#0d9488',
  manual: '#2563eb',
  'has-gps': '#71717a',
  'before-track': '#d97706',
  'after-track': '#d97706',
  'in-gap': '#d97706',
  'outside-fetched-range': '#d97706',
  'no-capture-time': '#dc2626',
  excluded: '#dc2626',
}
