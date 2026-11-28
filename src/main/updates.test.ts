import type { UpdateState } from '@shared/ipc'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installKind, newerRelease, startUpdates, type UpdaterDeps } from './updates'

describe('installKind', () => {
  const kind = (platform: NodeJS.Platform, vars: Record<string, string> = {}, packaged = true) =>
    installKind({ platform, packaged, vars })

  it('NSIS installs update themselves; portable and macOS only get a notice', () => {
    expect(kind('win32')).toBe('nsis')
    expect(kind('win32', { PORTABLE_EXECUTABLE_DIR: 'C:\\Users\\me\\Downloads' })).toBe('notice')
    expect(kind('darwin')).toBe('notice')
    expect(kind('linux')).toBe('off')
  })

  it('off in tests and unpackaged runs', () => {
    expect(kind('win32', { STECKNADEL_E2E: '1' })).toBe('off')
    expect(kind('darwin', { STECKNADEL_E2E: '1' })).toBe('off')
    expect(kind('win32', {}, false)).toBe('off')
    expect(kind('darwin', {}, false)).toBe('off')
  })
})

describe('newerRelease', () => {
  it('compares as semver, not as text', () => {
    expect(newerRelease('0.9.0', { tag_name: 'v0.10.0' })).toBe('0.10.0')
    expect(newerRelease('0.10.0', { tag_name: 'v0.9.0' })).toBeNull()
    expect(newerRelease('1.0.0', { tag_name: 'v1.0.0' })).toBeNull()
    expect(newerRelease('1.0.0-beta.1', { tag_name: 'v1.0.0' })).toBe('1.0.0')
  })

  it('ignores anything that is not a version', () => {
    expect(newerRelease('1.0.0', { tag_name: 'nightly' })).toBeNull()
    expect(newerRelease('1.0.0', { tag_name: 3 })).toBeNull()
    expect(newerRelease('1.0.0', {})).toBeNull()
  })
})

describe('startUpdates', () => {
  afterEach(() => vi.useRealTimers())

  function deps(over: Partial<UpdaterDeps>): UpdaterDeps & { states: UpdateState[] } {
    const states: UpdateState[] = []
    return {
      kind: 'notice',
      version: '0.1.0',
      fetchJson: async () => ({ tag_name: 'v0.2.0' }),
      nsis: () => Promise.reject(new Error('not on this platform')),
      onState: (s) => states.push(s),
      log: () => {},
      states,
      ...over,
    }
  }

  it('off: never checks', async () => {
    const fetchJson = vi.fn()
    const d = deps({ kind: 'off', fetchJson })
    startUpdates(d)
    await vi.waitFor(() => expect(d.states).toEqual([]))
    expect(fetchJson).not.toHaveBeenCalled()
  })

  it('notice: points at the release page when GitHub has a newer version, every 6 h', async () => {
    vi.useFakeTimers()
    const fetchJson = vi.fn(async () => ({ tag_name: 'v0.2.0' }))
    const d = deps({ fetchJson })
    const updates = startUpdates(d)
    await vi.advanceTimersByTimeAsync(0)
    const available = {
      kind: 'available',
      version: '0.2.0',
      url: 'https://github.com/LekoArts/stecknadel/releases/latest',
    }
    expect(updates.state()).toEqual(available)
    expect(fetchJson).toHaveBeenCalledWith(
      'https://api.github.com/repos/LekoArts/stecknadel/releases/latest',
    )
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(fetchJson).toHaveBeenCalledTimes(2)
    updates.stop()
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(fetchJson).toHaveBeenCalledTimes(2)
  })

  it('notice: a failed check is logged and changes nothing', async () => {
    const log = vi.fn()
    const d = deps({ fetchJson: () => Promise.reject(new Error('offline')), log })
    const updates = startUpdates(d)
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('update check: offline'))
    expect(updates.state()).toEqual({ kind: 'none' })
    updates.stop()
  })

  it('nsis: checks with electron-updater and offers the restart once downloaded', async () => {
    let downloaded: ((info: { version: string }) => void) | undefined
    const updater = {
      checkForUpdatesAndNotify: vi.fn(async () => null),
      on: (_: 'update-downloaded', fn: (info: { version: string }) => void) => {
        downloaded = fn
      },
      quitAndInstall: vi.fn(),
    }
    const fetchJson = vi.fn()
    const d = deps({ kind: 'nsis', nsis: async () => updater, fetchJson })
    const updates = startUpdates(d)
    await vi.waitFor(() => expect(updater.checkForUpdatesAndNotify).toHaveBeenCalled())
    expect(fetchJson).not.toHaveBeenCalled()
    downloaded?.({ version: '0.2.0' })
    expect(d.states).toEqual([{ kind: 'ready', version: '0.2.0' }])
    updates.install()
    expect(updater.quitAndInstall).toHaveBeenCalled()
    updates.stop()
  })
})
