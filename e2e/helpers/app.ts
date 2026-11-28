import { join } from 'node:path'
import { type ElectronApplication, _electron as electron } from '@playwright/test'

const root = join(__dirname, '../..')

/** Path to the executable of the unpacked (`electron-builder --dir`) package for this platform. */
export function packagedDirExecutable(): string {
  switch (process.platform) {
    case 'darwin':
      return join(root, 'dist/mac-arm64/Stecknadel.app/Contents/MacOS/Stecknadel')
    case 'win32':
      return join(root, 'dist/win-unpacked/Stecknadel.exe')
    default:
      throw new Error(`No packaged build for ${process.platform}`)
  }
}

/** Launches the packaged app: the `installed` project passes STECKNADEL_APP_PATH, others use the --dir build. */
export async function launchApp(
  env: Record<string, string> = {},
  options: { recordVideo?: { dir: string; size?: { width: number; height: number } } } = {},
): Promise<ElectronApplication> {
  return electron.launch({
    ...options,
    executablePath: process.env.STECKNADEL_APP_PATH || packagedDirExecutable(),
    // STECKNADEL_E2E exposes the test-only preview snapshot (never set in a normal launch).
    env: { ...process.env, STECKNADEL_E2E: '1', ...env } as Record<string, string>,
  })
}
