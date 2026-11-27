import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type SafeStorageLike, Secrets, SecretsUnavailableError } from './secrets'

const KEY = 'dawarich-secret-key'

const fakeStorage = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(`enc:${Buffer.from(plain).toString('base64')}`),
  decryptString: (encrypted) => {
    const s = encrypted.toString()
    if (!s.startsWith('enc:')) throw new Error('bad ciphertext')
    return Buffer.from(s.slice(4), 'base64').toString()
  },
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'steck-secrets-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('Secrets', () => {
  it('round-trips the key through safeStorage, never storing it in plain text', async () => {
    const file = join(dir, 'userData/secrets.bin')
    const secrets = new Secrets(file, fakeStorage())
    expect(await secrets.hasKey()).toBe(false)
    await secrets.setKey(KEY)
    expect(await secrets.getKey()).toBe(KEY)
    expect(await secrets.hasKey()).toBe(true)
    expect((await readFile(file)).toString()).not.toContain(KEY)
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
    await secrets.clearKey()
    expect(await secrets.hasKey()).toBe(false)
  })

  it('refuses to save when the OS offers no secure storage', async () => {
    const secrets = new Secrets(join(dir, 'secrets.bin'), fakeStorage(false))
    expect(secrets.available()).toBe(false)
    await expect(secrets.setKey(KEY)).rejects.toThrow(SecretsUnavailableError)
    await expect(stat(join(dir, 'secrets.bin'))).rejects.toThrow()
    expect(await secrets.getKey()).toBeNull()
  })

  it('treats an undecryptable file as no key', async () => {
    const file = join(dir, 'secrets.bin')
    await new Secrets(file, fakeStorage()).setKey(KEY)
    const other = new Secrets(file, {
      ...fakeStorage(),
      decryptString: () => {
        throw new Error('wrong keychain')
      },
    })
    expect(await other.hasKey()).toBe(false)
  })
})
