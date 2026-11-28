// `pnpm dev` and `pnpm start` run the stock Electron.app, whose bundle name is what macOS shows in
// the menu bar (app.setName can't change it). Rename the local copy so it reads "Stecknadel".
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

if (process.platform === 'darwin') {
  const executable = createRequire(import.meta.url)('electron')
  const plist = join(executable, '../../Info.plist')
  if (existsSync(plist)) {
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} Stecknadel`, plist])
    }
  }
}
