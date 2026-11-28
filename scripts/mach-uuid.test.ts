import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rewriteUuid } from './mach-uuid.mjs'

const electron = join(
  __dirname,
  '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
)

describe.runIf(process.platform === 'darwin')('rewriteUuid', () => {
  it('gives the executable a new UUID that depends on the app id, and changes nothing else', () => {
    const original = readFileSync(electron)
    const a = Buffer.from(original)
    const b = Buffer.from(original)
    const changeA = rewriteUuid(a, 'com.lekoarts.stecknadel')
    const changeB = rewriteUuid(b, 'com.example.other')
    expect(changeA.to).not.toBe(changeA.from)
    expect(changeA.to).not.toBe(changeB.to)
    expect(rewriteUuid(Buffer.from(original), 'com.lekoarts.stecknadel').to).toBe(changeA.to)
    const differing = [...a.keys()].filter((i) => a[i] !== original[i])
    expect(differing.length).toBeGreaterThan(0)
    expect(Math.max(...differing) - Math.min(...differing)).toBeLessThan(16)
  })

  it('refuses a file that is not a 64-bit Mach-O', () => {
    expect(() => rewriteUuid(Buffer.from('#!/bin/sh\n'.padEnd(64)), 'x')).toThrow(/Mach-O/)
  })
})
