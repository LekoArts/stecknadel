#!/usr/bin/env node
// Decides whether the release workflow builds a release, and tags it if needed.
// Prints nothing and writes nothing while the version is 0.0.0 or its release is complete.
// Otherwise appends `tag=v<version>` to $GITHUB_OUTPUT: after creating and pushing a missing
// tag, or for an existing tag whose release is missing or lacks assets (a retry).
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const requiredAssets = (version) => [
  `Stecknadel-${version}-setup.exe`,
  `Stecknadel-${version}-setup.exe.blockmap`,
  `Stecknadel-${version}-portable.exe`,
  `Stecknadel-${version}.dmg`,
  `Stecknadel-${version}.dmg.blockmap`,
  'latest.yml',
  'latest-mac.yml',
]

/**
 * @param {object} io
 * @param {string} io.version            package.json version at HEAD
 * @param {(cmd: string, args: string[]) => { code: number, stdout: string, stderr: string }} io.run
 * @param {(line: string) => void} io.output  appends to $GITHUB_OUTPUT
 * @returns {string | null} the tag to build, if any
 */
export function tagRelease({ version, run, output }) {
  if (version === '0.0.0') return null
  const tag = `v${version}`
  const must = (cmd, args) => {
    const r = run(cmd, args)
    if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr.trim()}`)
    return r.stdout
  }

  const remote = must('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])
  if (remote.trim() === '') {
    must('git', ['tag', '-a', tag, '-m', tag, 'HEAD'])
    must('git', ['push', 'origin', `refs/tags/${tag}`])
    output(`tag=${tag}`)
    return tag
  }

  must('git', ['fetch', '--no-tags', 'origin', `+refs/tags/${tag}:refs/tags/${tag}`])
  const tagged = JSON.parse(must('git', ['show', `${tag}:package.json`])).version
  if (tagged !== version) {
    throw new Error(`${tag} points at a commit with version ${tagged}, not ${version}`)
  }

  const view = run('gh', ['release', 'view', tag, '--json', 'assets,isDraft'])
  if (view.code !== 0) {
    if (!view.stderr.includes('release not found')) {
      throw new Error(`gh release view ${tag} failed: ${view.stderr.trim()}`)
    }
    output(`tag=${tag}`)
    return tag
  }
  const release = JSON.parse(view.stdout)
  const have = new Set(release.assets.map((a) => a.name))
  // A draft isn't released yet, even with every file: the publish job completes and publishes it.
  if (!release.isDraft && requiredAssets(version).every((name) => have.has(name))) return null
  output(`tag=${tag}`)
  return tag
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    tagRelease({
      version: JSON.parse(readFileSync('package.json', 'utf8')).version,
      run: (cmd, args) => {
        const r = spawnSync(cmd, args, { encoding: 'utf8' })
        if (r.error) return { code: 1, stdout: '', stderr: r.error.message }
        return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
      },
      output: (line) => {
        if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is not set')
        appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`)
      },
    })
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
