import { type MatchKind, type MatchStatus, PLACED_KINDS } from '@shared/match/status'

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

/** Legend counts per status, over `scope` (the selected camera's photo ids) or all photos. */
export function statusCounts(
  statuses: Map<string, MatchStatus>,
  scope: Set<string> | null,
): Map<MatchKind, number> {
  const counts = new Map<MatchKind, number>()
  for (const [id, s] of statuses) {
    if (!scope || scope.has(id)) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1)
  }
  return counts
}

/** Photos without a position the user should look at, in `scope` or all. */
export function notPlacedIds(
  statuses: Map<string, MatchStatus>,
  scope: Set<string> | null,
): string[] {
  return [...statuses]
    .filter(
      ([id, s]) => (!scope || scope.has(id)) && !PLACED_KINDS.has(s.kind) && s.kind !== 'has-gps',
    )
    .map(([id]) => id)
}
