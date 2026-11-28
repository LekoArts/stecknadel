import type { UpdateState } from '@shared/ipc'
import semver from 'semver'

const RELEASES_API = 'https://api.github.com/repos/LekoArts/stecknadel/releases/latest'
const RELEASES_PAGE = 'https://github.com/LekoArts/stecknadel/releases/latest'
const SIX_HOURS = 6 * 60 * 60 * 1000

/**
 * How this copy updates. The NSIS install replaces itself (electron-updater, `latest.yml`); the
 * portable exe and the unsigned macOS app can't, so they only point at the release page.
 */
export type InstallKind = 'nsis' | 'notice' | 'off'

export function installKind(env: {
  platform: NodeJS.Platform
  packaged: boolean
  vars: Record<string, string | undefined>
}): InstallKind {
  if (!env.packaged || env.vars.STECKNADEL_E2E === '1') return 'off'
  if (env.platform === 'win32') return env.vars.PORTABLE_EXECUTABLE_DIR ? 'notice' : 'nsis'
  return env.platform === 'darwin' ? 'notice' : 'off'
}

/** The newer release, if the latest one on GitHub is ahead of `current`. */
export function newerRelease(current: string, latest: { tag_name?: unknown }): string | null {
  const tag = typeof latest.tag_name === 'string' ? semver.clean(latest.tag_name) : null
  return tag && semver.valid(current) && semver.gt(tag, current) ? tag : null
}

export async function latestRelease(
  current: string,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<UpdateState> {
  const body = await fetchJson(RELEASES_API)
  const version = newerRelease(current, (body ?? {}) as { tag_name?: unknown })
  return version ? { kind: 'available', version, url: RELEASES_PAGE } : { kind: 'none' }
}

/** What `startUpdates` needs from Electron, so it can be tested without it. */
export interface UpdaterDeps {
  kind: InstallKind
  version: string
  fetchJson: (url: string) => Promise<unknown>
  /** electron-updater's autoUpdater, loaded only for the NSIS install. */
  nsis: () => Promise<{
    checkForUpdatesAndNotify: () => Promise<unknown>
    on: (event: 'update-downloaded', listener: (info: { version: string }) => void) => void
    quitAndInstall: () => void
  }>
  onState: (state: UpdateState) => void
  log: (message: string) => void
}

export interface Updates {
  state: () => UpdateState
  /** Restarts into the downloaded update (NSIS only). */
  install: () => void
  stop: () => void
}

/** Checks on start and every 6 h; failures are logged and the next check tries again. */
export function startUpdates(deps: UpdaterDeps): Updates {
  let state: UpdateState = { kind: 'none' }
  let install = (): void => {}
  const set = (next: UpdateState): void => {
    state = next
    deps.onState(next)
  }
  let check = async (): Promise<void> => {}
  if (deps.kind === 'nsis') {
    const updater = deps.nsis()
    updater
      .then((u) => {
        u.on('update-downloaded', (info) => set({ kind: 'ready', version: info.version }))
        install = () => u.quitAndInstall()
      })
      .catch((e) => deps.log(`updater: ${(e as Error).message}`))
    check = async () => {
      await (await updater).checkForUpdatesAndNotify()
    }
  } else if (deps.kind === 'notice') {
    check = async () => {
      const next = await latestRelease(deps.version, deps.fetchJson)
      if (next.kind !== 'none' || state.kind === 'none') set(next)
    }
  }
  const run = (): void => {
    if (state.kind === 'ready') return
    check().catch((e) => deps.log(`update check: ${(e as Error).message}`))
  }
  if (deps.kind === 'off') return { state: () => state, install, stop: () => {} }
  run()
  const timer = setInterval(run, SIX_HOURS)
  timer.unref?.()
  return { state: () => state, install: () => install(), stop: () => clearInterval(timer) }
}
