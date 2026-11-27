// @vitest-environment jsdom
import type { ThumbnailResult } from '@shared/library'
import { act, render, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
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

/** Answers every request made so far, including ones the freed slots start. */
async function answerAll(): Promise<void> {
  for (let guard = 0; guard < 20; guard += 1) {
    const batch = requests.splice(0, requests.length)
    if (batch.length === 0) return
    await act(async () => {
      for (const r of batch) r.deferred.resolve(thumb(r.id))
      await Promise.all(batch.map((r) => r.deferred.promise))
    })
  }
}

function Tile({ id }: { id: string }): React.JSX.Element {
  const result = useThumbnail(id)
  return <div data-testid={id}>{result?.url ?? 'none'}</div>
}

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

  it('drops an answer that arrives after the cache was cleared for another folder', async () => {
    renderHook(({ id }) => useThumbnail(id), { initialProps: { id: 'p1' } })
    expect(requests).toHaveLength(1)

    // Cleared while p1 is still in flight: its answer belongs to the old folder.
    clearThumbnailCache()
    renderHook(({ id }) => useThumbnail(id), { initialProps: { id: 'p1' } })
    expect(requests).toHaveLength(2)
    await act(async () => {
      requests[0].deferred.resolve(thumb('p1-old'))
      await requests[0].deferred.promise
    })

    // The stale answer must not be in the cache: a new tile asks again.
    renderHook(({ id }) => useThumbnail(id), { initialProps: { id: 'p1' } })
    expect(requests).toHaveLength(3)

    await act(async () => {
      requests[1].deferred.resolve(thumb('p1-new'))
      await requests[1].deferred.promise
    })
    const { result } = renderHook(({ id }) => useThumbnail(id), { initialProps: { id: 'p1' } })
    expect(result.current?.url).toContain('p1-new')
    expect(requests).toHaveLength(3)
  })

  it('loads every tile under StrictMode with the queue saturated', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`)
    const { getByTestId } = render(
      <StrictMode>
        {ids.map((id) => (
          <Tile key={id} id={id} />
        ))}
      </StrictMode>,
    )
    await answerAll()
    for (const id of ids) expect(getByTestId(id).textContent).toContain(id)
  })
})
