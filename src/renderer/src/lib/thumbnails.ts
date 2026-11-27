import type { ThumbnailResult } from '@shared/library'
import { useEffect, useState } from 'react'

const MAX_IN_FLIGHT = 6
const cache = new Map<string, ThumbnailResult>()
const queue: Job[] = []
let inFlight = 0
/** Bumped when the cache is cleared: answers for the previous folder must not refill it. */
let epoch = 0

interface Job {
  id: string
  epoch: number
  resolve: (result: ThumbnailResult | null) => void
  /** The tile that asked is gone: its answer must not land in the tile that replaced it. */
  cancelled: boolean
}

function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
    const job = queue.shift()
    if (!job || job.cancelled) continue
    inFlight += 1
    window.stecknadel
      .getThumbnail({ id: job.id })
      .then(
        (result) => {
          if (job.epoch === epoch) cache.set(job.id, result)
          if (!job.cancelled) job.resolve(result)
        },
        () => {
          if (!job.cancelled) job.resolve(null)
        },
      )
      .finally(() => {
        inFlight -= 1
        pump()
      })
  }
}

export function clearThumbnailCache(): void {
  epoch += 1
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
    const job: Job = { id, epoch, resolve: setResult, cancelled: false }
    queue.push(job)
    pump()
    return () => {
      job.cancelled = true
    }
  }, [id])
  return result
}
