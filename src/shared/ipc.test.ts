import { describe, expect, it } from 'vitest'
import { type IpcName, ipcChannel, ipcContract, ipcNames } from './ipc'

/** For every channel: inputs its schema must accept and inputs it must reject. */
const samples: { [K in IpcName]: { valid: unknown[]; invalid: unknown[] } } = {
  getAppInfo: {
    valid: [undefined],
    invalid: [null, {}, 'x', 1, [], { path: '/etc/passwd' }],
  },
}

describe('ipc contract', () => {
  it('has samples for every channel', () => {
    expect(Object.keys(samples).sort()).toEqual([...ipcNames].sort())
  })

  it('uses namespaced, unique channel names', () => {
    const channels = ipcNames.map(ipcChannel)
    expect(new Set(channels).size).toBe(channels.length)
    for (const channel of channels) expect(channel).toMatch(/^stecknadel:[a-zA-Z]+$/)
  })

  for (const name of ipcNames) {
    describe(name, () => {
      const { input } = ipcContract[name]
      for (const value of samples[name].valid) {
        it(`accepts ${JSON.stringify(value) ?? 'undefined'}`, () => {
          expect(input.safeParse(value).success).toBe(true)
        })
      }
      for (const value of samples[name].invalid) {
        it(`rejects ${JSON.stringify(value)}`, () => {
          expect(input.safeParse(value).success).toBe(false)
        })
      }
    })
  }
})
