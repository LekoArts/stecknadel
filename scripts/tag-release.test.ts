import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { requiredAssets } from './tag-release.mjs'

const SCRIPT = resolve(__dirname, 'tag-release.mjs')
const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A clone of a bare origin at `version`, plus a fake `gh` on PATH answering from a file. */
function repo(version: string) {
  const root = mkdtempSync(join(tmpdir(), 'steck-tag-'))
  dirs.push(root)
  const origin = join(root, 'origin.git')
  const work = join(root, 'work')
  git(root, 'init', '-q', '--bare', '-b', 'main', origin)
  git(root, 'clone', '-q', origin, work)
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 'test@example.com'],
    ['tag.gpgSign', 'false'],
    ['commit.gpgSign', 'false'],
  ])
    git(work, 'config', k, v)
  const commit = (v: string) => {
    writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'stecknadel', version: v }))
    git(work, 'add', 'package.json')
    git(work, 'commit', '-q', '-m', v)
    git(work, 'push', '-q', 'origin', 'HEAD:main')
  }
  commit(version)

  const bin = join(root, 'bin')
  const answer = join(root, 'gh-answer.json')
  execFileSync('mkdir', [bin])
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env node
const a = JSON.parse(require('fs').readFileSync(${JSON.stringify(answer)}, 'utf8'))
process.stdout.write(a.stdout ?? ''); process.stderr.write(a.stderr ?? ''); process.exit(a.code ?? 0)
`,
  )
  chmodSync(join(bin, 'gh'), 0o755)
  const gh = (a: { code?: number; stdout?: string; stderr?: string }) =>
    writeFileSync(answer, JSON.stringify(a))
  gh({ code: 1, stderr: 'release not found\n' })

  const output = join(root, 'github-output')
  writeFileSync(output, '')
  const run = () => {
    const r = spawnSync(process.execPath, [SCRIPT], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: output },
    })
    return {
      code: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      output: readFileSync(output, 'utf8'),
    }
  }
  const remoteTags = () => git(work, 'ls-remote', '--tags', 'origin')
  return { work, commit, gh, run, remoteTags }
}

const assets = (version: string, drop?: string, isDraft = false) => ({
  stdout: JSON.stringify({
    isDraft,
    assets: requiredAssets(version)
      .filter((n: string) => n !== drop)
      .map((name: string) => ({ name })),
  }),
})

describe.skipIf(process.platform === 'win32')('tag-release', () => {
  it('0.0.0: no tag and no output', () => {
    const r = repo('0.0.0')
    expect(r.run()).toMatchObject({ code: 0, stdout: '', stderr: '', output: '' })
    expect(r.remoteTags()).toBe('')
  })

  it('a new version: creates and pushes an annotated tag on HEAD and emits it', () => {
    const r = repo('0.1.0')
    expect(r.run()).toMatchObject({ code: 0, output: 'tag=v0.1.0\n' })
    expect(r.remoteTags()).toContain('refs/tags/v0.1.0')
    expect(git(r.work, 'cat-file', '-t', 'v0.1.0')).toBe('tag')
    expect(git(r.work, 'rev-parse', 'v0.1.0^{commit}')).toBe(git(r.work, 'rev-parse', 'HEAD'))
  })

  it('an existing tag without a release is re-emitted, not re-created', () => {
    const r = repo('0.1.0')
    r.run()
    const before = r.remoteTags()
    const again = r.run()
    expect(again).toMatchObject({ code: 0, output: 'tag=v0.1.0\ntag=v0.1.0\n' })
    expect(r.remoteTags()).toBe(before)
  })

  it('an existing tag whose release lacks an asset is re-emitted', () => {
    const r = repo('0.1.0')
    r.run()
    r.gh({ ...assets('0.1.0', 'latest-mac.yml') })
    expect(r.run()).toMatchObject({ code: 0, output: 'tag=v0.1.0\ntag=v0.1.0\n' })
  })

  it('a draft release with every asset is re-emitted, so it gets published', () => {
    const r = repo('0.1.0')
    r.run()
    r.gh(assets('0.1.0', undefined, true))
    expect(r.run()).toMatchObject({ code: 0, output: 'tag=v0.1.0\ntag=v0.1.0\n' })
  })

  it('a gh auth or network error fails instead of guessing', () => {
    const r = repo('0.1.0')
    r.run()
    r.gh({ code: 1, stderr: 'HTTP 401: Bad credentials\n' })
    const res = r.run()
    expect(res.code).not.toBe(0)
    expect(res.stderr).toContain('Bad credentials')
    expect(res.output).toBe('tag=v0.1.0\n')
  })

  it('an existing tag with a complete release: no output', () => {
    const r = repo('0.1.0')
    r.run()
    r.gh(assets('0.1.0'))
    expect(r.run()).toMatchObject({ code: 0, stdout: '', output: 'tag=v0.1.0\n' })
  })

  it('an existing tag on a commit with another version is an error', () => {
    const r = repo('0.1.0')
    // Someone tagged v0.2.0 by hand on the 0.1.0 commit.
    git(r.work, 'tag', '-a', 'v0.2.0', '-m', 'v0.2.0')
    git(r.work, 'push', '-q', 'origin', 'refs/tags/v0.2.0')
    git(r.work, 'tag', '-d', 'v0.2.0')
    r.commit('0.2.0')
    const res = r.run()
    expect(res.code).not.toBe(0)
    expect(res.stderr).toContain('v0.2.0 points at a commit with version 0.1.0')
    expect(res.output).toBe('')
  })
})
