import type { ThumbnailResult } from '@shared/library'
import { useEffect, useState } from 'react'

const MAX_IN_FLIGHT = 6
const cache = new Map<string, ThumbnailResult>()
const queue: { id: string; resolve: (r: ThumbnailResult | null) => void; cancelled: boolean }[] = []
let inFlight = 0

function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
    const job = queue.shift()
    if (!job || job.cancelled) continue
    inFlight += 1
    window.stecknadel
      .getThumbnail({ id: job.id })
      .then(
        (result) => {
          cache.set(job.id, result)
          job.resolve(result)
        },
        () => job.resolve(null),
      )
      .finally(() => {
        inFlight -= 1
        pump()
      })
  }
}

export function clearThumbnailCache(): void {
  cache.clear()
  for (const job of queue) job.cancelled = true
  queue.length = 0
}

/**
 * The tile's thumbnail: `undefined` while loading, `null` when it failed. Requests are bounded to
 * a few in flight, and ones for tiles scrolled out of view before they started are dropped.
 */
export function useThumbnail(id: string): ThumbnailResult | null | undefined {
  const [result, setResult] = useState<ThumbnailResult | null | undefined>(() => cache.get(id))
  useEffect(() => {
    const cached = cache.get(id)
    if (cached) {
      setResult(cached)
      return
    }
    setResult(undefined)
    const job = { id, resolve: setResult, cancelled: false }
    queue.push(job)
    pump()
    return () => {
      job.cancelled = true
    }
  }, [id])
  return result
}
