// @vitest-environment jsdom
import type { ThumbnailResult } from '@shared/library'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearThumbnailCache, useThumbnail } from './thumbnails'

interface Deferred {
  promise: Promise<ThumbnailResult>
  resolve: (value: ThumbnailResult) => void
}

const requests: { id: string; deferred: Deferred }[] = []

function deferred(): Deferred {
  let resolve: (value: ThumbnailResult) => void = () => {}
  const promise = new Promise<ThumbnailResult>((r) => {
    resolve = (value) => r(value)
  })
  return { promise, resolve }
}

const thumb = (name: string): ThumbnailResult => ({
  url: `stecknadel-thumb://thumb/${name}.jpg`,
  rotate: 0,
})

describe('useThumbnail', () => {
  beforeEach(() => {
    clearThumbnailCache()
    requests.length = 0
    ;(window as unknown as { stecknadel: unknown }).stecknadel = {
      getThumbnail: ({ id }: { id: string }) => {
        const d = deferred()
        requests.push({ id, deferred: d })
        return d.promise
      },
    }
  })

  it('does not hand an old photo’s thumbnail to the tile that replaced it', async () => {
    const { result, rerender } = renderHook(({ id }) => useThumbnail(id), {
      initialProps: { id: 'p1' },
    })
    expect(requests.map((r) => r.id)).toEqual(['p1'])

    // The tile now shows another photo while p1's request is still out.
    rerender({ id: 'p2' })
    expect(requests.map((r) => r.id)).toEqual(['p1', 'p2'])

    await act(async () => {
      requests[0].deferred.resolve(thumb('p1'))
      await requests[0].deferred.promise
    })
    expect(result.current).toBeUndefined()

    await act(async () => {
      requests[1].deferred.resolve(thumb('p2'))
      await requests[1].deferred.promise
    })
    expect(result.current?.url).toContain('p2')
  })

  it('starts over after the cache is cleared for another folder', async () => {
    const first = renderHook(({ id }) => useThumbnail(id), { initialProps: { id: 'p1' } })
    await act(async () => {
      requests[0].deferred.resolve(thumb('p1'))
      await requests[0].deferred.promise
    })
    expect(first.result.current?.url).toContain('p1')

    clearThumbnailCache()
    const second = renderHook(({ id }) => useThumbnail(id), { initialProps: { id: 'p1' } })
    expect(requests).toHaveLength(2)
    await act(async () => {
      requests[1].deferred.resolve(thumb('p1-new'))
      await requests[1].deferred.promise
    })
    expect(second.result.current?.url).toContain('p1-new')
  })
})
